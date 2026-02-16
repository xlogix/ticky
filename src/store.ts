import { promises as fs } from "node:fs";
import path from "node:path";
import { CompletionTarget, ConversationSettings, StoreData, Task, TaskFilter } from "./types";

const DEFAULT_DATA: StoreData = {
  tasks: [],
  settings: {},
};

const DEFAULT_COMPLETION_TARGET: CompletionTarget = "channel";

function nowIso(): string {
  return new Date().toISOString();
}

function makeTaskId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class TodoStore {
  private readonly filePath: string;
  private data: StoreData | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    await this.enqueue(async () => {
      await this.ensureFile();
      this.data = await this.readFile();
    });
  }

  async createTask(input: {
    title: string;
    createdBy: string;
    assignee: string | null;
    conversationId: string;
  }): Promise<Task> {
    return this.enqueue(async () => {
      const data = await this.getData();
      const timestamp = nowIso();
      const task: Task = {
        id: makeTaskId(),
        title: input.title,
        createdBy: input.createdBy,
        assignee: input.assignee,
        conversationId: input.conversationId,
        done: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        doneAt: null,
        doneBy: null,
        messageTs: null,
        discussionStartedAt: null,
      };

      data.tasks.push(task);
      await this.persist(data);
      return task;
    });
  }

  async getTask(taskId: string): Promise<Task | null> {
    return this.enqueue(async () => {
      const data = await this.getData();
      const task = data.tasks.find((item) => item.id === taskId);
      return task ? { ...task } : null;
    });
  }

  async listTasks(filter: TaskFilter = {}): Promise<Task[]> {
    return this.enqueue(async () => {
      const data = await this.getData();
      const participants = filter.participants ?? [];

      const items = data.tasks
        .filter((task) => {
          if (filter.conversationId && task.conversationId !== filter.conversationId) {
            return false;
          }

          if (!filter.includeDone && task.done) {
            return false;
          }

          if (participants.length === 0) {
            return true;
          }

          const involved = new Set<string>([task.createdBy]);
          if (task.assignee) {
            involved.add(task.assignee);
          }

          return participants.every((participant) => involved.has(participant));
        })
        .sort((left, right) => {
          if (left.done !== right.done) {
            return left.done ? 1 : -1;
          }
          return right.updatedAt.localeCompare(left.updatedAt);
        });

      return items.map((task) => ({ ...task }));
    });
  }

  async markTask(
    taskId: string,
    done: boolean,
    actorId: string,
  ): Promise<{ task: Task | null; changed: boolean }> {
    return this.enqueue(async () => {
      const data = await this.getData();
      const task = data.tasks.find((item) => item.id === taskId);

      if (!task) {
        return { task: null, changed: false };
      }

      const changed = task.done !== done;
      if (!changed) {
        return { task: { ...task }, changed: false };
      }

      task.done = done;
      task.updatedAt = nowIso();
      task.doneAt = done ? task.updatedAt : null;
      task.doneBy = done ? actorId : null;

      await this.persist(data);
      return { task: { ...task }, changed: true };
    });
  }

  async updateTaskMetadata(
    taskId: string,
    updates: { messageTs?: string | null; discussionStartedAt?: string | null },
  ): Promise<Task | null> {
    return this.enqueue(async () => {
      const data = await this.getData();
      const task = data.tasks.find((item) => item.id === taskId);

      if (!task) {
        return null;
      }

      if (Object.prototype.hasOwnProperty.call(updates, "messageTs")) {
        task.messageTs = updates.messageTs ?? null;
      }

      if (Object.prototype.hasOwnProperty.call(updates, "discussionStartedAt")) {
        task.discussionStartedAt = updates.discussionStartedAt ?? null;
      }

      task.updatedAt = nowIso();
      await this.persist(data);
      return { ...task };
    });
  }

  async getConversationSettings(conversationId: string): Promise<ConversationSettings> {
    return this.enqueue(async () => {
      const data = await this.getData();
      const existing = data.settings[conversationId];

      if (existing) {
        return { ...existing };
      }

      return {
        conversationId,
        postCompletionUpdate: false,
        completionTarget: DEFAULT_COMPLETION_TARGET,
        updatedAt: nowIso(),
      };
    });
  }

  async upsertConversationSettings(
    conversationId: string,
    updates: { postCompletionUpdate: boolean; completionTarget: CompletionTarget },
  ): Promise<ConversationSettings> {
    return this.enqueue(async () => {
      const data = await this.getData();
      const current = data.settings[conversationId] ?? {
        conversationId,
        postCompletionUpdate: false,
        completionTarget: DEFAULT_COMPLETION_TARGET,
        updatedAt: nowIso(),
      };

      const next: ConversationSettings = {
        ...current,
        postCompletionUpdate: updates.postCompletionUpdate,
        completionTarget: updates.completionTarget,
        updatedAt: nowIso(),
      };

      data.settings[conversationId] = next;
      await this.persist(data);
      return { ...next };
    });
  }

  private async enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queue.then(op, op);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async ensureFile(): Promise<void> {
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true });

    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, JSON.stringify(DEFAULT_DATA, null, 2), "utf8");
    }
  }

  private async readFile(): Promise<StoreData> {
    const raw = await fs.readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw) as StoreData;

    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {},
    };
  }

  private async getData(): Promise<StoreData> {
    if (!this.data) {
      await this.ensureFile();
      this.data = await this.readFile();
    }
    return this.data;
  }

  private async persist(data: StoreData): Promise<void> {
    const tmpPath = `${this.filePath}.tmp`;
    const serialized = JSON.stringify(data, null, 2);

    await fs.writeFile(tmpPath, serialized, "utf8");
    await fs.rename(tmpPath, this.filePath);
    this.data = data;
  }
}
