import { App } from "@slack/bolt";
import { buildCreateTaskFromMessageModal } from "../../blocks";
import { TodoStore } from "../../store";

export function registerTodoShortcuts(app: App, store: TodoStore): void {
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
}
