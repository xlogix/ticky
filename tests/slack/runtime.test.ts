import { describe, expect, it, vi } from "vitest";
import { TodoRuntime } from "../../src/slack/runtime";
import { makeTask } from "../helpers/task-fixtures";

describe("TodoRuntime", () => {
  it("posts todo message and returns ts", async () => {
    const store = { getConversationSettings: vi.fn() } as any;
    const runtime = new TodoRuntime(store);
    const client = {
      chat: {
        postMessage: vi.fn(async () => ({ ts: "123.456" })),
      },
    } as any;

    const ts = await runtime.postTodoMessage({
      client,
      channelId: "C1",
      text: "Todo",
      blocks: [],
    });

    expect(ts).toBe("123.456");
  });

  it("falls back to respond() when channel_not_found", async () => {
    const store = { getConversationSettings: vi.fn() } as any;
    const runtime = new TodoRuntime(store);
    const respond = vi.fn(async () => undefined);
    const client = {
      chat: {
        postMessage: vi.fn(async () => {
          throw { data: { error: "channel_not_found" } };
        }),
      },
    } as any;

    const ts = await runtime.postTodoMessage({
      client,
      respond,
      channelId: "D1",
      text: "Todo",
      blocks: [{ type: "section" }],
    });

    expect(ts).toBeNull();
    expect(respond).toHaveBeenCalledWith({
      response_type: "in_channel",
      text: "Todo",
      blocks: [{ type: "section" }],
    });
  });

  it("sends completion notification to conversation or creator DM", async () => {
    const settingsStore = {
      getConversationSettings: vi
        .fn()
        .mockResolvedValueOnce({ postCompletionUpdate: true, completionTarget: "channel" })
        .mockResolvedValueOnce({ postCompletionUpdate: true, completionTarget: "dm_creator" }),
    } as any;
    const runtime = new TodoRuntime(settingsStore);

    const client = {
      chat: {
        postMessage: vi.fn(async () => ({})),
      },
    } as any;

    const task = makeTask({
      title: "Fix <bug>",
      conversationId: "C77",
      messageTs: "777.888",
      createdBy: "UCREATOR",
    });

    await runtime.notifyOnCompletion(task, "UACTOR", client);
    await runtime.notifyOnCompletion(task, "UACTOR", client);

    expect(client.chat.postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        channel: "C77",
        thread_ts: "777.888",
      }),
    );

    expect(client.chat.postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        channel: "UCREATOR",
      }),
    );
  });

  it("does not send completion notification when disabled", async () => {
    const store = {
      getConversationSettings: vi.fn(async () => ({
        postCompletionUpdate: false,
        completionTarget: "channel",
      })),
    } as any;
    const runtime = new TodoRuntime(store);
    const client = { chat: { postMessage: vi.fn() } } as any;

    await runtime.notifyOnCompletion(makeTask(), "UACTOR", client);

    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it("skips canonical sync when card has no message ts", async () => {
    const store = { getConversationSettings: vi.fn() } as any;
    const runtime = new TodoRuntime(store);
    const client = {
      chat: {
        update: vi.fn(),
      },
    } as any;

    await runtime.syncCanonicalTaskCard(makeTask({ messageTs: null }), undefined, client);

    expect(client.chat.update).not.toHaveBeenCalled();
  });

  it("skips canonical sync when source ts already matches", async () => {
    const store = { getConversationSettings: vi.fn() } as any;
    const runtime = new TodoRuntime(store);
    const client = { chat: { update: vi.fn() } } as any;

    await runtime.syncCanonicalTaskCard(makeTask({ messageTs: "123.456" }), "123.456", client);

    expect(client.chat.update).not.toHaveBeenCalled();
  });

  it("applies toggle update and triggers sync + completion notification", async () => {
    const task = makeTask({ done: true });
    const store = {
      markTask: vi.fn(async () => ({ task, changed: true })),
      getConversationSettings: vi.fn(async () => ({ postCompletionUpdate: false })),
    } as any;
    const runtime = new TodoRuntime(store);
    const syncSpy = vi.spyOn(runtime, "syncCanonicalTaskCard").mockResolvedValue();
    const notifySpy = vi.spyOn(runtime, "notifyOnCompletion").mockResolvedValue();

    const client = {
      chat: {
        update: vi.fn(async () => ({})),
      },
    } as any;

    await runtime.applyTaskToggle({
      taskId: task.id,
      done: true,
      actorId: "UACTOR",
      sourceChannel: "C1",
      sourceMessage: {
        ts: "123.000",
        text: "Todo list",
        blocks: [{ block_id: `task_section:${task.id}`, type: "section", text: { text: "x" } }],
      },
      client,
      respond: vi.fn(async () => undefined),
    });

    expect(store.markTask).toHaveBeenCalledWith(task.id, true, "UACTOR");
    expect(syncSpy).toHaveBeenCalled();
    expect(notifySpy).toHaveBeenCalledWith(task, "UACTOR", client);
  });

  it("falls back to respond replace when update channel not found", async () => {
    const task = makeTask({ done: false });
    const store = {
      markTask: vi.fn(async () => ({ task, changed: false })),
      getConversationSettings: vi.fn(),
    } as any;
    const runtime = new TodoRuntime(store);
    const respond = vi.fn(async () => undefined);

    const client = {
      chat: {
        update: vi.fn(async () => {
          throw { data: { error: "channel_not_found" } };
        }),
      },
    } as any;

    await runtime.applyTaskToggle({
      taskId: task.id,
      done: false,
      actorId: "UACTOR",
      sourceChannel: "D1",
      sourceMessage: {
        ts: "999.999",
        text: "Todo list",
        blocks: [{ block_id: `task_section:${task.id}`, type: "section", text: { text: "x" } }],
      },
      client,
      respond,
    });

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        replace_original: true,
      }),
    );
  });

  it("returns early when toggled task no longer exists", async () => {
    const store = {
      markTask: vi.fn(async () => ({ task: null, changed: false })),
      getConversationSettings: vi.fn(),
    } as any;
    const runtime = new TodoRuntime(store);
    const client = { chat: { update: vi.fn() } } as any;

    await runtime.applyTaskToggle({
      taskId: "task_missing",
      done: true,
      actorId: "UACTOR",
      client,
      respond: vi.fn(),
    });

    expect(client.chat.update).not.toHaveBeenCalled();
  });
});
