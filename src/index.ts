import { App } from "@slack/bolt";
import dotenv from "dotenv";
import path from "node:path";
import {
  buildCreateTaskFromMessageModal,
  buildEditTaskModal,
  buildSettingsModal,
  buildTaskCardBlocks,
  buildTaskListBlocks,
  updateBlocksWithTaskState,
} from "./blocks";
import { TodoStore } from "./store";
import { CompletionTarget, Task } from "./types";

dotenv.config();

const botToken = process.env.SLACK_BOT_TOKEN;
const signingSecret = process.env.SLACK_SIGNING_SECRET;
const appToken = process.env.SLACK_APP_TOKEN;
const mongoUri = process.env.MONGODB_URI ?? process.env.MONGODB;
const mongoDbName = process.env.MONGODB_DB_NAME;

if (!botToken || !signingSecret) {
  throw new Error("SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET are required.");
}

const storePath = path.resolve(process.cwd(), process.env.STORE_PATH ?? "data/store.json");
const store = new TodoStore({
  filePath: storePath,
  mongoUri,
  mongoDbName,
});

if (process.env.MONGODB && !process.env.MONGODB_URI) {
  console.warn("[config] MONGODB is deprecated. Please rename it to MONGODB_URI.");
}

const app = new App({
  token: botToken,
  signingSecret,
  socketMode: Boolean(appToken),
  ...(appToken ? { appToken } : {}),
});

function usageText(): string {
  return [
    "Mini Task Manager Commands:",
    "• /todo add <@user> <task>  - create a task for someone",
    "• /todo add <task>           - create an unassigned task",
    "  (Tip: pick assignee from Slack mention autocomplete)",
    "• /todo list [@user] [all]   - list open tasks in this conversation",
    "• /todo between <@u1> <@u2> [all] - list tasks involving two people",
    "• /todo settings             - configure completion update behavior",
    '• Message shortcut: "Add message to Ticky" - turn a DM message into a task',
    "• /todo help                 - show this help",
  ].join("\n");
}

function extractMentionedUsers(text: string): string[] {
  // Supports both <@U12345> and <@U12345|display_name> formats.
  // Restrict to Slack user IDs so placeholders like <@user> are not treated as real assignees.
  const matches = text.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g);
  const users = Array.from(matches, (match) => match[1]);
  return Array.from(new Set(users));
}

function stripFirstMentionToken(text: string, userId: string): string {
  const escaped = userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`<@${escaped}(?:\\|[^>]+)?>`), "").trim();
}

function looksLikeUnresolvedAssigneeToken(text: string): boolean {
  const firstToken = (text.trim().split(/\\s+/)[0] ?? "").trim();
  if (!firstToken) {
    return false;
  }

  // Placeholder-like token that is not a Slack user ID mention.
  if (/^<@[^>]+>$/.test(firstToken) && !/^<@[UW][A-Z0-9]+(?:\\|[^>]+)?>$/.test(firstToken)) {
    return true;
  }

  // Plain @handle token (slash commands only resolve assignees reliably via escaped IDs).
  if (/^@[A-Za-z0-9._-]+$/.test(firstToken)) {
    return true;
  }

  return false;
}

function formatListTitle(participants: string[]): string {
  if (participants.length === 2) {
    return `Todos between <@${participants[0]}> and <@${participants[1]}>`;
  }
  if (participants.length === 1) {
    return `Todos involving <@${participants[0]}>`;
  }
  return "Todos in this conversation";
}

function normalizeCompletionTarget(value: string | undefined): CompletionTarget {
  return value === "dm_creator" ? "dm_creator" : "channel";
}

function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isChannelNotFoundError(error: unknown): boolean {
  const slackError = error as { data?: { error?: string } };
  return slackError?.data?.error === "channel_not_found";
}

function commandErrorMessage(error: unknown): string {
  const slackError = error as { data?: { error?: string } };
  const code = slackError?.data?.error;

  if (code === "channel_not_found") {
    return "I can't post in this conversation. Use a DM with Ticky or invite @Ticky to the channel.";
  }

  if (code === "invalid_blocks" || code === "invalid_arguments") {
    return "I couldn't format that task text for Slack. Try again with a simpler task title.";
  }

  return "Something failed while handling the command. Check app logs.";
}

function parseToggleButtonValue(raw: string | undefined): { taskId: string; done: boolean } | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { taskId?: string; done?: boolean };
    if (!parsed.taskId || typeof parsed.done !== "boolean") {
      return null;
    }
    return {
      taskId: parsed.taskId,
      done: parsed.done,
    };
  } catch {
    return null;
  }
}

function normalizeTaskId(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const quoted = trimmed.match(/^"(.+)"$/);
  return quoted ? quoted[1] : trimmed;
}

function extractTaskIdFromBlocks(blocks: any[] | undefined): string | null {
  if (!Array.isArray(blocks)) {
    return null;
  }

  for (const block of blocks) {
    const blockId = typeof block?.block_id === "string" ? block.block_id : "";
    const fromBlockId = blockId.match(/^task_(?:card|section|actions|card_actions):(.+)$/);
    if (fromBlockId?.[1]) {
      return normalizeTaskId(fromBlockId[1]);
    }

    if (blockId.startsWith("task_card_context:")) {
      const candidate = blockId.replace("task_card_context:", "");
      return normalizeTaskId(candidate);
    }
  }

  for (const block of blocks) {
    const elements = Array.isArray(block?.elements) ? block.elements : [];
    for (const element of elements) {
      const text = typeof element?.text === "string" ? element.text : "";
      const match = text.match(/Task ID:\\s*([A-Za-z0-9_]+)/);
      if (match?.[1]) {
        return normalizeTaskId(match[1]);
      }
    }
  }

  return null;
}

async function postTodoMessage(input: {
  client: any;
  respond?: any;
  channelId: string;
  text: string;
  blocks: any[];
}): Promise<string | null> {
  try {
    const result = await input.client.chat.postMessage({
      channel: input.channelId,
      text: input.text,
      blocks: input.blocks,
    });
    return result.ts ?? null;
  } catch (error) {
    if (!isChannelNotFoundError(error) || !input.respond) {
      throw error;
    }

    // In some DM contexts, posting via chat.postMessage is restricted.
    // Slash command respond() can still post into the originating conversation.
    await input.respond({
      response_type: "in_channel",
      text: input.text,
      blocks: input.blocks,
    });
    return null;
  }
}

async function openSettingsModal(
  client: any,
  triggerId: string,
  conversationId: string,
): Promise<void> {
  const settings = await store.getConversationSettings(conversationId);
  await client.views.open({
    trigger_id: triggerId,
    view: buildSettingsModal({
      conversationId,
      settings,
    }),
  });
}

async function notifyOnCompletion(task: Task, actorId: string, client: any): Promise<void> {
  const settings = await store.getConversationSettings(task.conversationId);

  if (!settings.postCompletionUpdate) {
    return;
  }

  const text = `:white_check_mark: *${escapeMrkdwn(task.title)}* marked done by <@${actorId}>`;

  if (settings.completionTarget === "channel") {
    await client.chat.postMessage({
      channel: task.conversationId,
      text,
      ...(task.messageTs ? { thread_ts: task.messageTs } : {}),
    });
    return;
  }

  await client.chat.postMessage({
    channel: task.createdBy,
    text: `${text}\nConversation: ${task.conversationId.startsWith("D") ? "Direct Message" : `<#${task.conversationId}>`}`,
  });
}

async function syncCanonicalTaskCard(
  task: Task,
  sourceTs: string | undefined,
  client: any,
): Promise<void> {
  if (!task.messageTs) {
    return;
  }

  if (sourceTs && sourceTs === task.messageTs) {
    return;
  }

  try {
    await client.chat.update({
      channel: task.conversationId,
      ts: task.messageTs,
      text: `Todo: ${task.title}`,
      blocks: buildTaskCardBlocks(task),
    });
  } catch (error) {
    console.error("Failed to sync canonical task card", error);
  }
}

async function applyTaskToggle(input: {
  taskId: string;
  done: boolean;
  actorId: string;
  sourceChannel?: string;
  sourceMessage?: { ts?: string; text?: string; blocks?: any[] };
  client: any;
  respond: any;
}): Promise<void> {
  const { task, changed } = await store.markTask(input.taskId, input.done, input.actorId);
  if (!task) {
    return;
  }

  if (input.sourceChannel && input.sourceMessage?.ts && Array.isArray(input.sourceMessage.blocks)) {
    const nextBlocks = updateBlocksWithTaskState(input.sourceMessage.blocks, task);

    try {
      await input.client.chat.update({
        channel: input.sourceChannel,
        ts: input.sourceMessage.ts,
        text: input.sourceMessage.text ?? "Todo list",
        blocks: nextBlocks,
      });
    } catch (error) {
      if (isChannelNotFoundError(error)) {
        try {
          await input.respond({
            replace_original: true,
            text: input.sourceMessage.text ?? "Todo list",
            blocks: nextBlocks,
          });
        } catch (respondError) {
          console.error("Failed to update source message via respond()", respondError);
        }
        return;
      }
      console.error("Failed to update source message", error);
    }
  }

  await syncCanonicalTaskCard(task, input.sourceMessage?.ts, input.client);

  if (changed && task.done) {
    try {
      await notifyOnCompletion(task, input.actorId, input.client);
    } catch (error) {
      console.error("Failed to send completion update", error);
    }
  }
}

app.command("/todo", async ({ command, ack, respond, client }) => {
  await ack();

  const fullText = command.text.trim();
  const [subcommandRaw, ...restParts] = fullText.split(/\s+/);
  const subcommand = (subcommandRaw ?? "help").toLowerCase();
  const rest = restParts.join(" ").trim();
  console.log(
    `[todo.command] user=${command.user_id} channel=${command.channel_id} subcommand=${subcommand} text="${fullText}"`,
  );

  try {
    await store.trackUserActivity({
      userId: command.user_id,
      conversationId: command.channel_id,
      action: `command_${subcommand}`,
    });

    if (!fullText || subcommand === "help") {
      await respond({
        response_type: "ephemeral",
        text: usageText(),
      });
      return;
    }

    if (subcommand === "add") {
      const mentions = extractMentionedUsers(rest);
      const assignee = mentions[0] ?? null;

      if (!assignee && looksLikeUnresolvedAssigneeToken(rest)) {
        await respond({
          response_type: "ephemeral",
          text: "Couldn't resolve assignee. Mention a real Slack user from autocomplete (example: `/todo add @John finish report`) and ensure Slash Command escaping is enabled.",
        });
        return;
      }

      let title = rest;
      if (assignee) {
        title = stripFirstMentionToken(title, assignee);
      }

      if (!title) {
        await respond({
          response_type: "ephemeral",
          text: "Usage: /todo add <@user> <task> or /todo add <task>",
        });
        return;
      }

      const task = await store.createTask({
        title,
        createdBy: command.user_id,
        assignee,
        conversationId: command.channel_id,
        source: "slash_command",
      });

      const messageTs = await postTodoMessage({
        client,
        respond,
        channelId: command.channel_id,
        text: `Todo: ${escapeMrkdwn(title)}`,
        blocks: buildTaskCardBlocks(task),
      });

      if (messageTs) {
        await store.updateTaskMetadata(task.id, {
          messageTs,
        });
      }

      await respond({
        response_type: "ephemeral",
        text: `Created task *${title}*${assignee ? ` for <@${assignee}>` : ""}.`,
      });
      return;
    }

    if (subcommand === "list") {
      const mentions = extractMentionedUsers(rest);
      const includeDone = /\ball\b/i.test(rest);
      const participants = mentions.slice(0, 2);

      const tasks = await store.listTasks({
        conversationId: command.channel_id,
        participants,
        includeDone,
      });

      await postTodoMessage({
        client,
        respond,
        channelId: command.channel_id,
        text: "Todo list",
        blocks: buildTaskListBlocks({
          tasks,
          conversationId: command.channel_id,
          title: formatListTitle(participants),
          subtitle: includeDone
            ? "Showing open and completed tasks"
            : "Showing only open tasks (add `all` to include completed)",
        }),
      });

      await respond({
        response_type: "ephemeral",
        text: "Posted the todo list.",
      });
      return;
    }

    if (subcommand === "between") {
      const mentions = extractMentionedUsers(rest);
      const includeDone = /\ball\b/i.test(rest);

      if (mentions.length < 2) {
        await respond({
          response_type: "ephemeral",
          text: "Usage: /todo between <@user1> <@user2> [all]",
        });
        return;
      }

      const participants = mentions.slice(0, 2);
      const tasks = await store.listTasks({
        conversationId: command.channel_id,
        participants,
        includeDone,
      });

      await postTodoMessage({
        client,
        respond,
        channelId: command.channel_id,
        text: "Todo list between two people",
        blocks: buildTaskListBlocks({
          tasks,
          conversationId: command.channel_id,
          title: formatListTitle(participants),
          subtitle: includeDone
            ? "Showing open and completed tasks"
            : "Showing only open tasks (add `all` to include completed)",
        }),
      });

      await respond({
        response_type: "ephemeral",
        text: `Posted todos between <@${participants[0]}> and <@${participants[1]}>.`,
      });
      return;
    }

    if (subcommand === "settings") {
      await openSettingsModal(client, command.trigger_id, command.channel_id);
      return;
    }

    await respond({
      response_type: "ephemeral",
      text: usageText(),
    });
  } catch (error) {
    console.error("/todo handler failed", error);
    await respond({
      response_type: "ephemeral",
      text: commandErrorMessage(error),
    });
  }
});

app.action("toggle_task", async ({ ack, action, body, client, respond }) => {
  await ack();

  const checkboxAction = action as {
    options?: Array<{ value: string }>;
    selected_options?: Array<{ value: string }>;
  };

  const taskId = checkboxAction.options?.[0]?.value;
  if (!taskId) {
    return;
  }
  console.log(`[todo.toggle] user=${body.user.id} taskId=${taskId}`);
  await store.trackUserActivity({
    userId: body.user.id,
    conversationId: "channel" in body ? (body.channel?.id ?? null) : null,
    action: "task_toggle_checkbox",
  });

  const done = (checkboxAction.selected_options?.length ?? 0) > 0;
  const sourceChannel = "channel" in body ? body.channel?.id : undefined;
  const sourceMessage =
    "message" in body
      ? (body.message as { ts?: string; text?: string; blocks?: any[] })
      : undefined;

  await applyTaskToggle({
    taskId,
    done,
    actorId: body.user.id,
    sourceChannel,
    sourceMessage,
    client,
    respond,
  });
});

app.action("toggle_task_button", async ({ ack, action, body, client, respond }) => {
  await ack();

  const payload = parseToggleButtonValue((action as { value?: string }).value);
  if (!payload) {
    return;
  }
  console.log(
    `[todo.toggle.button] user=${body.user.id} taskId=${payload.taskId} done=${payload.done}`,
  );
  await store.trackUserActivity({
    userId: body.user.id,
    conversationId: "channel" in body ? (body.channel?.id ?? null) : null,
    action: "task_toggle_button",
  });

  const sourceChannel = "channel" in body ? body.channel?.id : undefined;
  const sourceMessage =
    "message" in body
      ? (body.message as { ts?: string; text?: string; blocks?: any[] })
      : undefined;

  await applyTaskToggle({
    taskId: payload.taskId,
    done: payload.done,
    actorId: body.user.id,
    sourceChannel,
    sourceMessage,
    client,
    respond,
  });
});

app.action("discuss_task", async ({ ack, body, action, client, respond }) => {
  await ack();

  const taskId = (action as { value?: string }).value;
  if (!taskId) {
    return;
  }
  console.log(`[todo.discuss] user=${body.user.id} taskId=${taskId}`);
  await store.trackUserActivity({
    userId: body.user.id,
    conversationId: "channel" in body ? (body.channel?.id ?? null) : null,
    action: "task_discuss",
  });

  const actorId = body.user.id;
  const sourceChannel = "channel" in body ? body.channel?.id : undefined;

  let task = await store.getTask(taskId);
  if (!task) {
    return;
  }

  try {
    if (!task.messageTs) {
      const postResult = await client.chat.postMessage({
        channel: task.conversationId,
        text: `Todo: ${escapeMrkdwn(task.title)}`,
        blocks: buildTaskCardBlocks(task),
      });

      task = (await store.updateTaskMetadata(task.id, { messageTs: postResult.ts })) ?? task;
    }

    if (!task.discussionStartedAt) {
      const discussion = await client.chat.postMessage({
        channel: task.conversationId,
        thread_ts: task.messageTs ?? undefined,
        text: `:speech_balloon: Discussion started by <@${actorId}> for *${escapeMrkdwn(task.title)}*`,
      });

      task =
        (await store.updateTaskMetadata(task.id, { discussionStartedAt: discussion.ts })) ?? task;
    }

    if (!task.messageTs) {
      await respond({
        text: "Couldn't open the task thread right now. Try again.",
      });
      return;
    }

    const permalinkResponse = await client.chat.getPermalink({
      channel: task.conversationId,
      message_ts: task.messageTs,
    });

    if (sourceChannel) {
      await client.chat.postEphemeral({
        channel: sourceChannel,
        user: actorId,
        text: `Open task thread: ${permalinkResponse.permalink}`,
      });
      return;
    }

    await respond({
      text: `Open task thread: ${permalinkResponse.permalink}`,
    });
  } catch (error) {
    if (isChannelNotFoundError(error)) {
      await respond({
        text: "Threaded discussion is unavailable in this DM. Use Ticky app DM or a channel with @Ticky invited.",
      });
      return;
    }
    console.error("Failed to open discussion", error);
  }
});

app.action("edit_task", async ({ ack, body, action, client, respond }) => {
  await ack();

  const actionTaskId = normalizeTaskId((action as { value?: string }).value);
  const triggerId = (body as { trigger_id?: string }).trigger_id;
  const sourceMessage = "message" in body ? (body.message as { blocks?: any[] }) : undefined;
  const fallbackTaskId = extractTaskIdFromBlocks(sourceMessage?.blocks);
  const taskId = actionTaskId ?? fallbackTaskId;
  if (!taskId || !triggerId) {
    return;
  }
  console.log(
    `[todo.edit.open] user=${body.user.id} taskId=${taskId}${actionTaskId ? "" : " (fallback from blocks)"}`,
  );
  await store.trackUserActivity({
    userId: body.user.id,
    conversationId: "channel" in body ? (body.channel?.id ?? null) : null,
    action: "task_edit_open",
  });

  const task = await store.getTask(taskId);
  if (!task) {
    await respond({
      text: "This task card is out of date or not in the active data store. Run `/todo list all` and edit from the latest list.",
    });
    return;
  }

  const sourceChannelId = "channel" in body ? body.channel?.id : undefined;
  const sourceMessageTs =
    "message" in body ? (body.message as { ts?: string | undefined })?.ts : undefined;

  await client.views.open({
    trigger_id: triggerId,
    view: buildEditTaskModal({
      task,
      sourceChannelId,
      sourceMessageTs,
    }) as any,
  });
});

app.action("message_to_task_help", async ({ ack, body, client }) => {
  await ack();

  const sourceChannelId = "channel" in body ? body.channel?.id : undefined;
  if (!sourceChannelId) {
    return;
  }
  await store.trackUserActivity({
    userId: body.user.id,
    conversationId: sourceChannelId,
    action: "message_to_task_help",
  });

  try {
    await client.chat.postEphemeral({
      channel: sourceChannelId,
      user: body.user.id,
      text: "Use a message shortcut: hover any message in DM/channel -> More actions -> Add message to Ticky.",
    });
  } catch (error) {
    console.error("Failed to show message-to-task help", error);
  }
});

app.action("open_todo_settings", async ({ ack, body, action, client }) => {
  await ack();

  const conversationId =
    (action as { value?: string }).value ?? ("channel" in body ? body.channel?.id : undefined);
  const triggerId = (body as { trigger_id?: string }).trigger_id;
  if (!conversationId) {
    return;
  }

  if (!triggerId) {
    return;
  }
  console.log(`[todo.settings.open] user=${body.user.id} conversation=${conversationId}`);
  await store.trackUserActivity({
    userId: body.user.id,
    conversationId,
    action: "settings_open",
  });

  await openSettingsModal(client, triggerId, conversationId);
});

app.shortcut("todo_add_message_as_task", async ({ shortcut, ack, client }) => {
  await ack();

  const payload = shortcut as {
    trigger_id?: string;
    channel?: { id?: string };
    user?: { id?: string };
    message?: { text?: string; user?: string };
  };

  const triggerId = payload.trigger_id;
  const conversationId = payload.channel?.id;
  const actorId = payload.user?.id;
  if (!triggerId || !conversationId || !actorId) {
    return;
  }
  await store.trackUserActivity({
    userId: actorId,
    conversationId,
    action: "shortcut_message_to_task_open",
  });

  const messageText =
    typeof payload.message?.text === "string" ? payload.message.text.trim() : "Follow up";
  const sourceMessageUser =
    typeof payload.message?.user === "string" ? payload.message.user : undefined;
  const defaultAssignee = null;

  console.log(
    `[todo.shortcut.message] user=${actorId} conversation=${conversationId} sourceUser=${sourceMessageUser ?? "unknown"}`,
  );

  await client.views.open({
    trigger_id: triggerId,
    view: buildCreateTaskFromMessageModal({
      conversationId,
      messageText,
      defaultAssignee,
    }) as any,
  });
});

app.view("todo_settings_modal", async ({ ack, body, view, client }) => {
  await ack();

  try {
    const metadata = JSON.parse(view.private_metadata || "{}") as { conversationId?: string };
    const conversationId = metadata.conversationId;
    console.log(
      `[todo.settings.save] user=${body.user.id} conversation=${conversationId ?? "unknown"}`,
    );

    if (!conversationId) {
      return;
    }
    await store.trackUserActivity({
      userId: body.user.id,
      conversationId,
      action: "settings_save",
    });

    const state = view.state.values as Record<string, Record<string, any>>;
    const updatesSelection = state.settings_updates?.post_completion_update?.selected_options as
      | Array<unknown>
      | undefined;
    const selectedTarget = state.settings_target?.completion_target?.selected_option?.value as
      | string
      | undefined;

    await store.upsertConversationSettings(conversationId, {
      postCompletionUpdate: (updatesSelection?.length ?? 0) > 0,
      completionTarget: normalizeCompletionTarget(selectedTarget),
    });

    try {
      await client.chat.postEphemeral({
        channel: conversationId,
        user: body.user.id,
        text: "Todo settings saved.",
      });
    } catch (error) {
      if (!isChannelNotFoundError(error)) {
        throw error;
      }
    }
  } catch (error) {
    console.error("Failed to save settings", error);
  }
});

app.view("todo_edit_task_modal", async ({ ack, body, view, client }) => {
  await ack();

  try {
    const metadata = JSON.parse(view.private_metadata || "{}") as {
      taskId?: string;
      sourceChannelId?: string;
      sourceMessageTs?: string;
    };

    const taskId = metadata.taskId;
    if (!taskId) {
      return;
    }
    await store.trackUserActivity({
      userId: body.user.id,
      conversationId: metadata.sourceChannelId ?? null,
      action: "task_edit_save",
    });

    const state = view.state.values as Record<string, Record<string, any>>;
    const title = (state.edit_title?.title?.value as string | undefined)?.trim();
    if (!title) {
      return;
    }

    const assignee = state.edit_assignee?.assignee?.selected_user as string | undefined;
    const doneSelection = state.edit_status?.done?.selected_options as Array<unknown> | undefined;
    const done = (doneSelection?.length ?? 0) > 0;

    let task = await store.updateTask(taskId, {
      title,
      assignee: assignee ?? null,
      actorId: body.user.id,
    });
    if (!task) {
      return;
    }

    const markResult = await store.markTask(task.id, done, body.user.id);
    task = markResult.task ?? task;

    await syncCanonicalTaskCard(task, metadata.sourceMessageTs, client);

    if (markResult.changed && task.done) {
      try {
        await notifyOnCompletion(task, body.user.id, client);
      } catch (error) {
        console.error("Failed to send completion update after edit", error);
      }
    }

    if (metadata.sourceChannelId) {
      try {
        await client.chat.postEphemeral({
          channel: metadata.sourceChannelId,
          user: body.user.id,
          text: "Task updated.",
        });
      } catch (error) {
        if (!isChannelNotFoundError(error)) {
          throw error;
        }
      }
    }

    console.log(`[todo.edit.save] user=${body.user.id} taskId=${taskId}`);
  } catch (error) {
    console.error("Failed to save task edit", error);
  }
});

app.view("todo_message_to_task_modal", async ({ ack, body, view, client }) => {
  await ack();

  try {
    const metadata = JSON.parse(view.private_metadata || "{}") as {
      conversationId?: string;
    };
    const conversationId = metadata.conversationId;
    if (!conversationId) {
      return;
    }
    await store.trackUserActivity({
      userId: body.user.id,
      conversationId,
      action: "shortcut_message_to_task_save",
    });

    const state = view.state.values as Record<string, Record<string, any>>;
    const title = (state.create_title?.title?.value as string | undefined)?.trim();
    if (!title) {
      return;
    }

    const selectedAssignee = state.create_assignee?.assignee?.selected_user as string | undefined;
    const assignee = selectedAssignee ?? null;

    const task = await store.createTask({
      title,
      createdBy: body.user.id,
      assignee,
      conversationId,
      source: "message_shortcut",
    });

    try {
      const postResult = await client.chat.postMessage({
        channel: conversationId,
        text: `Todo: ${escapeMrkdwn(task.title)}`,
        blocks: buildTaskCardBlocks(task),
      });

      if (postResult.ts) {
        await store.updateTaskMetadata(task.id, {
          messageTs: postResult.ts,
        });
      }
    } catch (error) {
      if (!isChannelNotFoundError(error)) {
        throw error;
      }

      await client.chat.postMessage({
        channel: body.user.id,
        text: `Created task from message: *${escapeMrkdwn(task.title)}*`,
      });
    }

    console.log(
      `[todo.shortcut.create] user=${body.user.id} conversation=${conversationId} taskId=${task.id}`,
    );
  } catch (error) {
    console.error("Failed to create task from message shortcut", error);
  }
});

app.error(async (error) => {
  console.error("Slack app error", error);
});

async function main(): Promise<void> {
  await store.init();

  const port = Number(process.env.PORT ?? 46731);
  await app.start(port);

  const mode = appToken ? "Socket Mode" : "HTTP Mode";
  const localUrl = `http://localhost:${port}`;
  console.log(`Ticky running on ${mode} (port ${port})`);
  console.log(`Local URL: ${localUrl}`);
  console.log(`Slack Events URL: ${localUrl}/slack/events`);
  if (appToken) {
    console.log("Socket Mode is enabled, so Slack does not need the Events URL.");
  }
}

main().catch((error) => {
  console.error("Application startup failed", error);
  process.exit(1);
});
