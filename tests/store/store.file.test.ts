import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TodoStore } from "../../src/store";

async function makeTempStore(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  const filePath = path.join(dir, "store.json");
  const store = new TodoStore({ filePath });
  return { dir, filePath, store };
}

async function readStoreFile(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as {
    tasks: Array<Record<string, unknown>>;
    settings: Record<string, Record<string, unknown>>;
    users: Record<string, Record<string, unknown>>;
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("TodoStore file mode", () => {
  it("initializes local file persistence", async () => {
    const ctx = await makeTempStore("ticky-store-init");
    tempDirs.push(ctx.dir);

    await ctx.store.init();

    const content = await readStoreFile(ctx.filePath);
    expect(content.tasks).toEqual([]);
    expect(content.settings).toEqual({});
    expect(content.users).toEqual({});
  });

  it("creates tasks and infers scope by conversation type", async () => {
    const ctx = await makeTempStore("ticky-store-scope");
    tempDirs.push(ctx.dir);
    await ctx.store.init();

    const dm = await ctx.store.createTask({
      title: "DM task",
      createdBy: "U1",
      assignee: null,
      conversationId: "D123",
    });

    const selfDm = await ctx.store.createTask({
      title: "Self task",
      createdBy: "U1",
      assignee: "U1",
      conversationId: "D123",
      source: "message_shortcut",
      recurrence: {
        enabled: true,
        cadence: "daily",
        interval: 0,
        timezone: "UTC",
        nextRunAt: null,
      },
    });

    const channel = await ctx.store.createTask({
      title: "Channel task",
      createdBy: "U1",
      assignee: "U2",
      conversationId: "C123",
      source: {
        kind: "system",
        sourceMessageTs: "123.456",
      },
    });

    expect(dm.scope).toBe("dm");
    expect(selfDm.scope).toBe("self");
    expect(channel.scope).toBe("channel");
    expect(selfDm.source.kind).toBe("message_shortcut");
    expect(selfDm.recurrence?.interval).toBe(1);
    expect(channel.source.sourceMessageTs).toBe("123.456");
  });

  it("validates parent task constraints for sub-tasks", async () => {
    const ctx = await makeTempStore("ticky-store-parent");
    tempDirs.push(ctx.dir);
    await ctx.store.init();

    const parent = await ctx.store.createTask({
      title: "Parent",
      createdBy: "U1",
      assignee: null,
      conversationId: "C123",
    });

    const subtask = await ctx.store.createTask({
      title: "Child",
      createdBy: "U1",
      assignee: null,
      parentTaskId: parent.id,
      conversationId: "C123",
    });

    expect(subtask.parentTaskId).toBe(parent.id);
    expect(subtask.sortOrder).toBe(1);

    await expect(
      ctx.store.createTask({
        title: "Missing parent",
        createdBy: "U1",
        assignee: null,
        parentTaskId: "task_missing",
        conversationId: "C123",
      }),
    ).rejects.toMatchObject({ code: "parent_task_not_found" });

    await expect(
      ctx.store.createTask({
        title: "Wrong conversation",
        createdBy: "U1",
        assignee: null,
        parentTaskId: parent.id,
        conversationId: "C999",
      }),
    ).rejects.toMatchObject({ code: "parent_task_mismatch" });
  });

  it("supports list filters and state transitions", async () => {
    const ctx = await makeTempStore("ticky-store-list");
    tempDirs.push(ctx.dir);
    await ctx.store.init();

    const task1 = await ctx.store.createTask({
      title: "One",
      createdBy: "U1",
      assignee: "U2",
      conversationId: "C123",
    });
    const task2 = await ctx.store.createTask({
      title: "Two",
      createdBy: "U2",
      assignee: null,
      conversationId: "C123",
    });

    await ctx.store.markTask(task2.id, true, "U2");

    const openOnly = await ctx.store.listTasks({ conversationId: "C123" });
    expect(openOnly.map((task) => task.id)).toEqual([task1.id]);

    const all = await ctx.store.listTasks({ conversationId: "C123", includeDone: true });
    expect(all).toHaveLength(2);

    const participants = await ctx.store.listTasks({
      conversationId: "C123",
      includeDone: true,
      participants: ["U1", "U2"],
    });
    expect(participants.map((task) => task.id)).toEqual([task1.id]);

    const doneResult = await ctx.store.markTask(task1.id, true, "U9");
    expect(doneResult.changed).toBe(true);
    expect(doneResult.task?.done).toBe(true);
    expect(doneResult.task?.doneBy).toBe("U9");

    const noChange = await ctx.store.markTask(task1.id, true, "U9");
    expect(noChange.changed).toBe(false);

    const reopened = await ctx.store.markTask(task1.id, false, "U9");
    expect(reopened.task?.done).toBe(false);
    expect(reopened.task?.doneAt).toBeNull();
  });

  it("updates metadata, task fields, settings, and user stats", async () => {
    const ctx = await makeTempStore("ticky-store-update");
    tempDirs.push(ctx.dir);
    await ctx.store.init();

    const task = await ctx.store.createTask({
      title: "Original",
      createdBy: "U1",
      assignee: null,
      conversationId: "D123",
    });

    const updatedMeta = await ctx.store.updateTaskMetadata(task.id, {
      messageTs: "999.111",
      discussionStartedAt: "999.222",
    });
    expect(updatedMeta?.messageTs).toBe("999.111");
    expect(updatedMeta?.discussionStartedAt).toBe("999.222");

    const updated = await ctx.store.updateTask(task.id, {
      title: "Updated",
      assignee: "U2",
      actorId: "U3",
    });
    expect(updated?.title).toBe("Updated");
    expect(updated?.assignee).toBe("U2");
    expect(updated?.scope).toBe("dm");

    const defaultSettings = await ctx.store.getConversationSettings("C123");
    expect(defaultSettings.postCompletionUpdate).toBe(false);
    expect(defaultSettings.completionTarget).toBe("channel");

    await ctx.store.upsertConversationSettings("C123", {
      postCompletionUpdate: true,
      completionTarget: "dm_creator",
    });

    const savedSettings = await ctx.store.getConversationSettings("C123");
    expect(savedSettings.postCompletionUpdate).toBe(true);
    expect(savedSettings.completionTarget).toBe("dm_creator");

    await ctx.store.trackUserActivity({
      userId: "U_TRACK",
      conversationId: "G123",
      action: "custom_action",
    });

    await ctx.store.trackUserActivity({
      userId: "",
      conversationId: "G123",
      action: "ignored",
    } as any);

    const data = await readStoreFile(ctx.filePath);
    expect(data.users.U1.stats.tasksCreated).toBeGreaterThanOrEqual(1);
    expect(data.users.U2.stats.tasksAssigned).toBeGreaterThanOrEqual(1);
    expect(data.users.U3.stats.tasksEdited).toBeGreaterThanOrEqual(1);
    expect(data.users.U_TRACK.lastAction).toBe("custom_action");
  });

  it("normalizes stored data when reading legacy/incomplete file", async () => {
    const ctx = await makeTempStore("ticky-store-normalize");
    tempDirs.push(ctx.dir);

    await fs.writeFile(
      ctx.filePath,
      JSON.stringify(
        {
          tasks: [
            {
              id: "task_legacy_1",
              title: "Legacy task",
              createdBy: "U1",
              conversationId: "D500",
              parentTaskId: '"task_parent"',
            },
            {
              foo: "invalid",
            },
          ],
          settings: {
            C1: {
              postCompletionUpdate: true,
            },
          },
          users: {
            U1: {
              stats: {
                tasksCreated: 2,
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await ctx.store.init();

    const task = await ctx.store.getTask('"task_legacy_1"');
    expect(task).not.toBeNull();
    expect(task?.conversationKind).toBe("dm");
    expect(task?.parentTaskId).toBe("task_parent");
    expect(task?.source.kind).toBe("slash_command");

    const settings = await ctx.store.getConversationSettings("C1");
    expect(settings.postCompletionUpdate).toBe(true);
    expect(settings.completionTarget).toBe("channel");

    await ctx.store.trackUserActivity({ userId: "U1", conversationId: "C1", action: "seen" });
    const data = await readStoreFile(ctx.filePath);
    expect(data.tasks).toHaveLength(1);
    expect(data.users.U1.stats.tasksCreated).toBe(2);
  });
});
