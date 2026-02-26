import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Doc = Record<string, any>;

const mockState = vi.hoisted(() => {
  return {
    connectShouldFail: false,
    dbs: new Map<string, Map<string, FakeCollection<any>>>(),
  };
});

function matchesClause(doc: Doc, clause: Doc): boolean {
  for (const [key, value] of Object.entries(clause)) {
    if (key === "$or") {
      const alternatives = Array.isArray(value) ? value : [];
      if (!alternatives.some((item) => matchesClause(doc, item))) {
        return false;
      }
      continue;
    }

    if (key === "$and") {
      const clauses = Array.isArray(value) ? value : [];
      if (!clauses.every((item) => matchesClause(doc, item))) {
        return false;
      }
      continue;
    }

    if (value && typeof value === "object" && "$in" in value) {
      const options = (value as { $in: unknown[] }).$in;
      if (!options.includes(doc[key])) {
        return false;
      }
      continue;
    }

    if (doc[key] !== value) {
      return false;
    }
  }

  return true;
}

class FakeCursor<T extends Doc> {
  private items: T[];

  constructor(items: T[]) {
    this.items = [...items];
  }

  sort(spec: Record<string, 1 | -1>) {
    const entries = Object.entries(spec);
    this.items.sort((left, right) => {
      for (const [field, direction] of entries) {
        const leftValue = left[field];
        const rightValue = right[field];

        if (leftValue === rightValue) {
          continue;
        }

        if (leftValue == null) {
          return direction === 1 ? -1 : 1;
        }

        if (rightValue == null) {
          return direction === 1 ? 1 : -1;
        }

        if (leftValue > rightValue) {
          return direction;
        }

        return -direction;
      }

      return 0;
    });
    return this;
  }

  limit(count: number) {
    this.items = this.items.slice(0, count);
    return this;
  }

  async next(): Promise<T | null> {
    return this.items[0] ?? null;
  }

  async toArray(): Promise<T[]> {
    return [...this.items];
  }
}

class FakeCollection<T extends Doc> {
  docs: T[] = [];

  async createIndex(): Promise<void> {
    return;
  }

  async insertOne(document: T): Promise<void> {
    this.docs.push(structuredClone(document));
  }

  async findOne(filter: Partial<T>): Promise<T | null> {
    const item = this.docs.find((doc) => matchesClause(doc, filter as Doc));
    return item ? structuredClone(item) : null;
  }

  find(query: Doc): FakeCursor<T> {
    const items = this.docs.filter((doc) => matchesClause(doc, query));
    return new FakeCursor(items);
  }

  async updateOne(filter: Doc, update: Doc, options?: { upsert?: boolean }): Promise<void> {
    const index = this.docs.findIndex((doc) => matchesClause(doc, filter));

    if (index < 0) {
      if (!options?.upsert) {
        return;
      }

      const inserted = {
        ...filter,
        ...(update.$setOnInsert ?? {}),
        ...(update.$set ?? {}),
      } as T;

      if (update.$inc) {
        for (const [key, delta] of Object.entries(update.$inc)) {
          inserted[key as keyof T] = (((inserted as any)[key] ?? 0) + Number(delta)) as any;
        }
      }

      this.docs.push(structuredClone(inserted));
      return;
    }

    const current = this.docs[index] as any;

    if (update.$set) {
      for (const [key, value] of Object.entries(update.$set)) {
        current[key] = value;
      }
    }

    if (update.$inc) {
      for (const [key, delta] of Object.entries(update.$inc)) {
        current[key] = (current[key] ?? 0) + Number(delta);
      }
    }
  }

  async bulkWrite(
    operations: Array<{
      updateOne: {
        filter: Doc;
        update: Doc;
        upsert: boolean;
      };
    }>,
  ): Promise<{ upsertedCount: number }> {
    let upsertedCount = 0;

    for (const operation of operations) {
      const { filter, update, upsert } = operation.updateOne;
      const existing = this.docs.find((doc) => matchesClause(doc, filter));
      if (!existing && upsert) {
        const next = {
          ...filter,
          ...(update.$setOnInsert ?? {}),
        } as T;
        this.docs.push(structuredClone(next));
        upsertedCount += 1;
      }
    }

    return { upsertedCount };
  }
}

class FakeDb {
  constructor(private readonly name: string) {}

  collection<T extends Doc>(collectionName: string): FakeCollection<T> {
    const dbCollections =
      mockState.dbs.get(this.name) ?? new Map<string, FakeCollection<any>>();
    mockState.dbs.set(this.name, dbCollections);

    const existing = dbCollections.get(collectionName);
    if (existing) {
      return existing as FakeCollection<T>;
    }

    const created = new FakeCollection<T>();
    dbCollections.set(collectionName, created);
    return created;
  }
}

class FakeMongoClient {
  constructor(private readonly uri: string) {
    void this.uri;
  }

  async connect(): Promise<void> {
    if (mockState.connectShouldFail) {
      throw new Error("mock connect failed");
    }
  }

  db(name: string): FakeDb {
    return new FakeDb(name);
  }

  async close(): Promise<void> {
    return;
  }
}

vi.mock("mongodb", () => {
  return {
    MongoClient: FakeMongoClient,
  };
});

async function loadTodoStore() {
  vi.resetModules();
  const mod = await import("../../src/store");
  return mod.TodoStore;
}

async function makeTempPath(prefix: string): Promise<{ dir: string; filePath: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  const filePath = path.join(dir, "store.json");
  return { dir, filePath };
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

beforeEach(() => {
  mockState.connectShouldFail = false;
  mockState.dbs.clear();
});

describe("TodoStore mongo mode (mocked)", () => {
  it("initializes mongo mode and migrates local data", async () => {
    const { dir, filePath } = await makeTempPath("ticky-store-mongo-migrate");
    tempDirs.push(dir);

    await fs.writeFile(
      filePath,
      JSON.stringify(
        {
          tasks: [
            {
              id: "task_local_1",
              title: "From file",
              createdBy: "U1",
              conversationId: "C1",
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
                tasksCreated: 1,
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const TodoStore = await loadTodoStore();
    const store = new TodoStore({
      filePath,
      mongoUri: "mongodb://fake:27017/ticky",
      mongoDbName: "ticky",
    });

    await store.init();

    const tasks = await store.listTasks({ conversationId: "C1", includeDone: true });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("task_local_1");

    const settings = await store.getConversationSettings("C1");
    expect(settings.postCompletionUpdate).toBe(true);
  });

  it("falls back to file mode when mongo connect fails", async () => {
    mockState.connectShouldFail = true;
    const { dir, filePath } = await makeTempPath("ticky-store-mongo-fallback");
    tempDirs.push(dir);

    const TodoStore = await loadTodoStore();
    const store = new TodoStore({
      filePath,
      mongoUri: "mongodb://fake:27017/ticky",
    });

    await store.init();

    const task = await store.createTask({
      title: "file fallback",
      createdBy: "U1",
      assignee: null,
      conversationId: "C1",
    });

    expect(task.title).toBe("file fallback");
    const data = JSON.parse(await fs.readFile(filePath, "utf8"));
    expect(data.tasks).toHaveLength(1);
  });

  it("supports create/list/update flows in mongo mode", async () => {
    const { dir, filePath } = await makeTempPath("ticky-store-mongo-crud");
    tempDirs.push(dir);

    const TodoStore = await loadTodoStore();
    const store = new TodoStore({
      filePath,
      mongoUri: "mongodb://fake:27017/ticky",
    });

    await store.init();

    const parent = await store.createTask({
      title: "Parent",
      createdBy: "U1",
      assignee: null,
      conversationId: "C1",
    });

    const child = await store.createTask({
      title: "Child",
      createdBy: "U1",
      assignee: "U2",
      conversationId: "C1",
      parentTaskId: parent.id,
    });

    expect(child.parentTaskId).toBe(parent.id);

    const listAll = await store.listTasks({
      conversationId: "C1",
      includeDone: true,
      participants: ["U1", "U2"],
    });
    expect(listAll.map((task) => task.id)).toEqual([child.id]);

    const metadata = await store.updateTaskMetadata(child.id, {
      messageTs: "123.456",
      discussionStartedAt: "123.789",
    });
    expect(metadata?.messageTs).toBe("123.456");

    const updated = await store.updateTask(child.id, {
      title: "Child updated",
      assignee: "U3",
      actorId: "U9",
    });
    expect(updated?.title).toBe("Child updated");
    expect(updated?.assignee).toBe("U3");

    const done = await store.markTask(child.id, true, "U9");
    expect(done.task?.done).toBe(true);

    const settings = await store.upsertConversationSettings("C1", {
      postCompletionUpdate: true,
      completionTarget: "dm_creator",
    });
    expect(settings.completionTarget).toBe("dm_creator");

    await store.trackUserActivity({
      userId: "U100",
      conversationId: "C1",
      action: "custom",
    });

    const fetched = await store.getTask(child.id);
    expect(fetched?.done).toBe(true);
  });
});
