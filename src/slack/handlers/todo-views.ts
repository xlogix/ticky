import { App } from "@slack/bolt";
import { normalizeCompletionTarget } from "../../app/todo-behavior";
import { buildTaskCardBlocks } from "../../blocks";
import { escapeMrkdwn, isChannelNotFoundError } from "../../slack/message-helpers";
import { TodoStore } from "../../store";
import { normalizeTaskId } from "../../tasks/id-helpers";
import { parseTaskGroupsFromText } from "../../tasks/input-parser";
import { Task } from "../../types";
import { TodoRuntime } from "../runtime";

export function registerTodoViews(app: App, store: TodoStore, runtime: TodoRuntime): void {
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

      await runtime.syncCanonicalTaskCard(task, metadata.sourceMessageTs, client);

      if (markResult.changed && task.done) {
        try {
          await runtime.notifyOnCompletion(task, body.user.id, client);
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

  app.view("todo_create_subtask_modal", async ({ ack, body, view, client }) => {
    await ack();

    try {
      const metadata = JSON.parse(view.private_metadata || "{}") as {
        parentTaskId?: string;
        sourceChannelId?: string;
        sourceMessageTs?: string;
      };

      const parentTaskId = normalizeTaskId(metadata.parentTaskId);
      if (!parentTaskId) {
        return;
      }

      const parentTask = await store.getTask(parentTaskId);
      if (!parentTask) {
        return;
      }

      await store.trackUserActivity({
        userId: body.user.id,
        conversationId: parentTask.conversationId,
        action: "subtask_create",
      });

      const state = view.state.values as Record<string, Record<string, any>>;
      const title = (state.create_subtask_title?.title?.value as string | undefined)?.trim();
      if (!title) {
        return;
      }

      const selectedAssignee = state.create_subtask_assignee?.assignee?.selected_user as
        | string
        | undefined;
      const assignee = selectedAssignee ?? null;

      const subtask = await store.createTask({
        title,
        createdBy: body.user.id,
        assignee,
        parentTaskId: parentTask.id,
        conversationId: parentTask.conversationId,
        source: "system",
      });

      let postedInConversation = false;
      try {
        const postResult = await client.chat.postMessage({
          channel: parentTask.conversationId,
          text: `Sub-task: ${escapeMrkdwn(subtask.title)}`,
          blocks: buildTaskCardBlocks(subtask),
        });

        postedInConversation = true;
        if (postResult.ts) {
          await store.updateTaskMetadata(subtask.id, {
            messageTs: postResult.ts,
          });
        }
      } catch (error) {
        if (!isChannelNotFoundError(error)) {
          throw error;
        }
      }

      if (!postedInConversation) {
        await client.chat.postMessage({
          channel: body.user.id,
          text: `Created sub-task *${escapeMrkdwn(subtask.title)}* under *${escapeMrkdwn(parentTask.title)}*.`,
        });
      } else if (metadata.sourceChannelId) {
        try {
          await client.chat.postEphemeral({
            channel: metadata.sourceChannelId,
            user: body.user.id,
            text: `Sub-task created under *${escapeMrkdwn(parentTask.title)}*.`,
          });
        } catch (error) {
          if (!isChannelNotFoundError(error)) {
            throw error;
          }
        }
      }

      console.log(`[todo.subtask.create] user=${body.user.id} parentTaskId=${parentTask.id}`);
    } catch (error) {
      console.error("Failed to create sub-task", error);
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
      const titleInput = (state.create_title?.title?.value as string | undefined)?.trim();
      if (!titleInput) {
        return;
      }

      const selectedAssignee = state.create_assignee?.assignee?.selected_user as string | undefined;
      const assignee = selectedAssignee ?? null;
      const parsedGroups = parseTaskGroupsFromText(titleInput);
      const maxTasksPerSubmission = 40;

      if (!parsedGroups.length) {
        return;
      }

      const createdTasks: Task[] = [];
      let attemptedCount = 0;

      for (const group of parsedGroups) {
        if (attemptedCount >= maxTasksPerSubmission) {
          break;
        }

        const parentTask = await store.createTask({
          title: group.text,
          createdBy: body.user.id,
          assignee,
          conversationId,
          source: "message_shortcut",
        });
        createdTasks.push(parentTask);
        attemptedCount += 1;

        for (const childTitle of group.children) {
          if (attemptedCount >= maxTasksPerSubmission) {
            break;
          }

          const subtask = await store.createTask({
            title: childTitle,
            createdBy: body.user.id,
            assignee,
            parentTaskId: parentTask.id,
            conversationId,
            source: "message_shortcut",
          });
          createdTasks.push(subtask);
          attemptedCount += 1;
        }
      }

      let usedFallbackDm = false;
      for (const task of createdTasks) {
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

          usedFallbackDm = true;
        }
      }

      if (usedFallbackDm) {
        const countSuffix = createdTasks.length === 1 ? "" : "s";
        await client.chat.postMessage({
          channel: body.user.id,
          text: `Created ${createdTasks.length} task${countSuffix} from message.`,
        });
      }

      const requestedCount = parsedGroups.reduce((sum, group) => sum + 1 + group.children.length, 0);

      if (attemptedCount < requestedCount) {
        const omitted = requestedCount - attemptedCount;
        const suffix = omitted === 1 ? "" : "s";
        try {
          await client.chat.postEphemeral({
            channel: conversationId,
            user: body.user.id,
            text: `Created the first ${attemptedCount} tasks. ${omitted} extra line${suffix} were skipped (limit ${maxTasksPerSubmission} per submission).`,
          });
        } catch (error) {
          if (!isChannelNotFoundError(error)) {
            throw error;
          }
        }
      }

      console.log(
        `[todo.shortcut.create] user=${body.user.id} conversation=${conversationId} created=${createdTasks.length}`,
      );
    } catch (error) {
      console.error("Failed to create task from message shortcut", error);
    }
  });
}
