import { App } from "@slack/bolt";
import {
  buildCreateSubtaskModal,
  buildEditTaskModal,
  buildTaskCardBlocks,
} from "../../blocks";
import { escapeMrkdwn, isChannelNotFoundError } from "../../slack/message-helpers";
import { TodoStore } from "../../store";
import { extractTaskIdFromBlocks, normalizeTaskId, parseToggleButtonValue } from "../../tasks/id-helpers";
import { TodoRuntime } from "../runtime";

export function registerTodoActions(app: App, store: TodoStore, runtime: TodoRuntime): void {
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

    await runtime.applyTaskToggle({
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

    await runtime.applyTaskToggle({
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

  app.action("add_subtask", async ({ ack, body, action, client, respond }) => {
    await ack();

    const parentTaskId = normalizeTaskId((action as { value?: string }).value);
    const triggerId = (body as { trigger_id?: string }).trigger_id;
    if (!parentTaskId || !triggerId) {
      return;
    }

    console.log(`[todo.subtask.open] user=${body.user.id} parentTaskId=${parentTaskId}`);
    await store.trackUserActivity({
      userId: body.user.id,
      conversationId: "channel" in body ? (body.channel?.id ?? null) : null,
      action: "subtask_open",
    });

    const parentTask = await store.getTask(parentTaskId);
    if (!parentTask) {
      await respond({
        text: "Parent task not found. Run `/todo list all` and try again.",
      });
      return;
    }

    const sourceChannelId = "channel" in body ? body.channel?.id : undefined;
    const sourceMessageTs =
      "message" in body ? (body.message as { ts?: string | undefined })?.ts : undefined;

    await client.views.open({
      trigger_id: triggerId,
      view: buildCreateSubtaskModal({
        parentTask,
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

    await runtime.openSettingsModal(client, triggerId, conversationId);
  });
}
