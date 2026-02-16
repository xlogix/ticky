import { App } from "@slack/bolt";
import dotenv from "dotenv";
import path from "node:path";
import {
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

if (!botToken || !signingSecret) {
  throw new Error("SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET are required.");
}

const storePath = path.resolve(process.cwd(), process.env.STORE_PATH ?? "data/store.json");
const store = new TodoStore(storePath);

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
    "• /todo list [@user] [all]   - list open tasks in this conversation",
    "• /todo between <@u1> <@u2> [all] - list tasks involving two people",
    "• /todo settings             - configure completion update behavior",
    "• /todo help                 - show this help",
  ].join("\n");
}

function extractMentionedUsers(text: string): string[] {
  // Supports both <@U12345> and <@U12345|display_name> formats.
  const matches = text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/gi);
  const users = Array.from(matches, (match) => match[1]);
  return Array.from(new Set(users));
}

function stripFirstMentionToken(text: string, userId: string): string {
  const escaped = userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`<@${escaped}(?:\\|[^>]+)?>`, "i"), "").trim();
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

async function openSettingsModal(client: any, triggerId: string, conversationId: string): Promise<void> {
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

  const text = `:white_check_mark: *${task.title}* marked done by <@${actorId}>`;

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

async function syncCanonicalTaskCard(task: Task, sourceTs: string | undefined, client: any): Promise<void> {
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

app.command("/todo", async ({ command, ack, respond, client }) => {
  await ack();

  const fullText = command.text.trim();
  const [subcommandRaw, ...restParts] = fullText.split(/\s+/);
  const subcommand = (subcommandRaw ?? "help").toLowerCase();
  const rest = restParts.join(" ").trim();

  try {
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
      });

      const postResult = await client.chat.postMessage({
        channel: command.channel_id,
        text: `Todo: ${title}`,
        blocks: buildTaskCardBlocks(task),
      });

      await store.updateTaskMetadata(task.id, {
        messageTs: postResult.ts,
      });

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

      await client.chat.postMessage({
        channel: command.channel_id,
        text: "Todo list",
        blocks: buildTaskListBlocks({
          tasks,
          conversationId: command.channel_id,
          title: formatListTitle(participants),
          subtitle: includeDone ? "Showing open and completed tasks" : "Showing only open tasks (add `all` to include completed)",
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

      await client.chat.postMessage({
        channel: command.channel_id,
        text: "Todo list between two people",
        blocks: buildTaskListBlocks({
          tasks,
          conversationId: command.channel_id,
          title: formatListTitle(participants),
          subtitle: includeDone ? "Showing open and completed tasks" : "Showing only open tasks (add `all` to include completed)",
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
      text: "Something failed while handling the command. Check app logs.",
    });
  }
});

app.action("toggle_task", async ({ ack, action, body, client }) => {
  await ack();

  const checkboxAction = action as {
    options?: Array<{ value: string }>;
    selected_options?: Array<{ value: string }>;
  };

  const taskId = checkboxAction.options?.[0]?.value;
  if (!taskId) {
    return;
  }

  const done = (checkboxAction.selected_options?.length ?? 0) > 0;
  const actorId = body.user.id;

  const { task, changed } = await store.markTask(taskId, done, actorId);
  if (!task) {
    return;
  }

  const sourceChannel = "channel" in body ? body.channel?.id : undefined;
  const sourceMessage = "message" in body ? (body.message as { ts?: string; text?: string; blocks?: any[] }) : undefined;

  if (sourceChannel && sourceMessage?.ts && Array.isArray(sourceMessage.blocks)) {
    try {
      await client.chat.update({
        channel: sourceChannel,
        ts: sourceMessage.ts,
        text: sourceMessage.text ?? "Todo list",
        blocks: updateBlocksWithTaskState(sourceMessage.blocks, task),
      });
    } catch (error) {
      console.error("Failed to update source message", error);
    }
  }

  await syncCanonicalTaskCard(task, sourceMessage?.ts, client);

  if (changed && task.done) {
    try {
      await notifyOnCompletion(task, actorId, client);
    } catch (error) {
      console.error("Failed to send completion update", error);
    }
  }
});

app.action("discuss_task", async ({ ack, body, action, client }) => {
  await ack();

  const taskId = (action as { value?: string }).value;
  if (!taskId) {
    return;
  }

  const actorId = body.user.id;
  const sourceChannel = "channel" in body ? body.channel?.id : undefined;

  let task = await store.getTask(taskId);
  if (!task) {
    return;
  }

  if (!task.messageTs) {
    const postResult = await client.chat.postMessage({
      channel: task.conversationId,
      text: `Todo: ${task.title}`,
      blocks: buildTaskCardBlocks(task),
    });

    task = (await store.updateTaskMetadata(task.id, { messageTs: postResult.ts })) ?? task;
  }

  if (!task.discussionStartedAt) {
    const discussion = await client.chat.postMessage({
      channel: task.conversationId,
      thread_ts: task.messageTs ?? undefined,
      text: `:speech_balloon: Discussion started by <@${actorId}> for *${task.title}*`,
    });

    task = (await store.updateTaskMetadata(task.id, { discussionStartedAt: discussion.ts })) ?? task;
  }

  if (!task.messageTs) {
    if (sourceChannel) {
      await client.chat.postEphemeral({
        channel: sourceChannel,
        user: actorId,
        text: "Couldn't open the task thread right now. Try again.",
      });
    }
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
  }
});

app.action("open_todo_settings", async ({ ack, body, action, client }) => {
  await ack();

  const conversationId = (action as { value?: string }).value ?? ("channel" in body ? body.channel?.id : undefined);
  const triggerId = (body as { trigger_id?: string }).trigger_id;
  if (!conversationId) {
    return;
  }

  if (!triggerId) {
    return;
  }

  await openSettingsModal(client, triggerId, conversationId);
});

app.view("todo_settings_modal", async ({ ack, body, view, client }) => {
  await ack();

  try {
    const metadata = JSON.parse(view.private_metadata || "{}") as { conversationId?: string };
    const conversationId = metadata.conversationId;

    if (!conversationId) {
      return;
    }

    const state = view.state.values as Record<string, Record<string, any>>;
    const updatesSelection = state.settings_updates?.post_completion_update?.selected_options as Array<unknown> | undefined;
    const selectedTarget = state.settings_target?.completion_target?.selected_option?.value as string | undefined;

    await store.upsertConversationSettings(conversationId, {
      postCompletionUpdate: (updatesSelection?.length ?? 0) > 0,
      completionTarget: normalizeCompletionTarget(selectedTarget),
    });

    await client.chat.postEphemeral({
      channel: conversationId,
      user: body.user.id,
      text: "Todo settings saved.",
    });
  } catch (error) {
    console.error("Failed to save settings", error);
  }
});

app.error(async (error) => {
  console.error("Slack app error", error);
});

async function main(): Promise<void> {
  await store.init();

  const port = Number(process.env.PORT ?? 3000);
  await app.start(port);

  const mode = appToken ? "Socket Mode" : "HTTP Mode";
  console.log(`Ticky running on ${mode} (port ${port})`);
}

main().catch((error) => {
  console.error("Application startup failed", error);
  process.exit(1);
});
