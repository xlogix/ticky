import { buildSettingsModal, buildTaskCardBlocks, updateBlocksWithTaskState } from "../blocks";
import { TodoStore } from "../store";
import { Task } from "../types";
import { escapeMrkdwn, isChannelNotFoundError } from "./message-helpers";

export class TodoRuntime {
  constructor(private readonly store: TodoStore) {}

  async postTodoMessage(input: {
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

  async openSettingsModal(client: any, triggerId: string, conversationId: string): Promise<void> {
    const settings = await this.store.getConversationSettings(conversationId);
    await client.views.open({
      trigger_id: triggerId,
      view: buildSettingsModal({
        conversationId,
        settings,
      }),
    });
  }

  async notifyOnCompletion(task: Task, actorId: string, client: any): Promise<void> {
    const settings = await this.store.getConversationSettings(task.conversationId);

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

  async syncCanonicalTaskCard(task: Task, sourceTs: string | undefined, client: any): Promise<void> {
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

  async applyTaskToggle(input: {
    taskId: string;
    done: boolean;
    actorId: string;
    sourceChannel?: string;
    sourceMessage?: { ts?: string; text?: string; blocks?: any[] };
    client: any;
    respond: any;
  }): Promise<void> {
    const { task, changed } = await this.store.markTask(input.taskId, input.done, input.actorId);
    if (!task) {
      return;
    }

    if (
      input.sourceChannel &&
      input.sourceMessage?.ts &&
      Array.isArray(input.sourceMessage.blocks)
    ) {
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

    await this.syncCanonicalTaskCard(task, input.sourceMessage?.ts, input.client);

    if (changed && task.done) {
      try {
        await this.notifyOnCompletion(task, input.actorId, input.client);
      } catch (error) {
        console.error("Failed to send completion update", error);
      }
    }
  }
}
