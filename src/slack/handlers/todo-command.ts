import { App } from "@slack/bolt";
import { usageText } from "../../app/usage";
import { commandErrorMessage, formatListTitle } from "../../app/todo-behavior";
import { buildTaskCardBlocks, buildTaskListBlocks } from "../../blocks";
import {
  extractMentionedUsers,
  resolveAssigneeAndTitleFromText,
  type SlackUsersClient,
} from "../../slack/assignee-resolver";
import { escapeMrkdwn } from "../../slack/message-helpers";
import { TodoStore } from "../../store";
import { splitFirstToken } from "../../tasks/input-parser";
import { normalizeTaskId } from "../../tasks/id-helpers";
import { TodoRuntime } from "../runtime";

export function registerTodoCommand(app: App, store: TodoStore, runtime: TodoRuntime): void {
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
        const parsed = await resolveAssigneeAndTitleFromText(rest, client as SlackUsersClient);
        if (!parsed.ok) {
          await respond({
            response_type: "ephemeral",
            text: parsed.message,
          });
          return;
        }

        const task = await store.createTask({
          title: parsed.title,
          createdBy: command.user_id,
          assignee: parsed.assignee,
          conversationId: command.channel_id,
          source: "slash_command",
        });

        const messageTs = await runtime.postTodoMessage({
          client,
          respond,
          channelId: command.channel_id,
          text: `Todo: ${escapeMrkdwn(parsed.title)}`,
          blocks: buildTaskCardBlocks(task),
        });

        if (messageTs) {
          await store.updateTaskMetadata(task.id, {
            messageTs,
          });
        }

        await respond({
          response_type: "ephemeral",
          text: `Created task *${parsed.title}*${parsed.assignee ? ` for <@${parsed.assignee}>` : ""}.`,
        });
        return;
      }

      if (subcommand === "sub") {
        const { first: parentToken, rest: subtaskInput } = splitFirstToken(rest);
        const parentTaskId = normalizeTaskId(parentToken ?? undefined);
        if (!parentTaskId || !subtaskInput) {
          await respond({
            response_type: "ephemeral",
            text: "Usage: /todo sub <task_id> [@user] <sub-task title>",
          });
          return;
        }

        const parentTask = await store.getTask(parentTaskId);
        if (!parentTask) {
          await respond({
            response_type: "ephemeral",
            text: "Parent task not found. Run `/todo list all` and copy a valid Task ID.",
          });
          return;
        }

        if (parentTask.conversationId !== command.channel_id) {
          await respond({
            response_type: "ephemeral",
            text: "Parent task belongs to another conversation. Create the sub-task in that same chat/channel.",
          });
          return;
        }

        const parsed = await resolveAssigneeAndTitleFromText(
          subtaskInput,
          client as SlackUsersClient,
        );
        if (!parsed.ok) {
          await respond({
            response_type: "ephemeral",
            text: parsed.message,
          });
          return;
        }

        const subtask = await store.createTask({
          title: parsed.title,
          createdBy: command.user_id,
          assignee: parsed.assignee,
          parentTaskId: parentTask.id,
          conversationId: command.channel_id,
          source: "slash_command",
        });

        const messageTs = await runtime.postTodoMessage({
          client,
          respond,
          channelId: command.channel_id,
          text: `Sub-task: ${escapeMrkdwn(parsed.title)}`,
          blocks: buildTaskCardBlocks(subtask),
        });

        if (messageTs) {
          await store.updateTaskMetadata(subtask.id, {
            messageTs,
          });
        }

        await respond({
          response_type: "ephemeral",
          text: `Created sub-task *${parsed.title}* under *${escapeMrkdwn(parentTask.title)}*${parsed.assignee ? ` for <@${parsed.assignee}>` : ""}.`,
        });
        return;
      }

      if (subcommand === "done" || subcommand === "reopen") {
        const { first: taskToken } = splitFirstToken(rest);
        const taskId = normalizeTaskId(taskToken ?? undefined);
        if (!taskId) {
          await respond({
            response_type: "ephemeral",
            text: `Usage: /todo ${subcommand} <task_id>`,
          });
          return;
        }

        const existing = await store.getTask(taskId);
        if (!existing || existing.conversationId !== command.channel_id) {
          await respond({
            response_type: "ephemeral",
            text: "Task not found in this conversation. Run `/todo list all` and copy a valid Task ID.",
          });
          return;
        }

        const done = subcommand === "done";
        const { task, changed } = await store.markTask(taskId, done, command.user_id);
        if (!task) {
          await respond({
            response_type: "ephemeral",
            text: "Task no longer exists.",
          });
          return;
        }

        await runtime.syncCanonicalTaskCard(task, undefined, client);

        if (changed && task.done) {
          try {
            await runtime.notifyOnCompletion(task, command.user_id, client);
          } catch (error) {
            console.error("Failed to send completion update", error);
          }
        }

        await respond({
          response_type: "ephemeral",
          text: done ? `Marked *${task.title}* as done.` : `Reopened *${task.title}*.`,
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

        await runtime.postTodoMessage({
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

        await runtime.postTodoMessage({
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
        await runtime.openSettingsModal(client, command.trigger_id, command.channel_id);
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
}
