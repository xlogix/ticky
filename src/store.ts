import { promises as fs } from "node:fs";
import path from "node:path";
import { Collection, Db, MongoClient } from "mongodb";
import {
  CompletionTarget,
  ConversationKind,
  ConversationSettings,
  StoreData,
  Task,
  TaskFilter,
  TaskRecurrence,
  TaskScope,
  TaskSource,
  TaskSourceKind,
  TrackUserActivityInput,
  UserProfile,
  UserPreferences,
  UserStats,
} from "./types";

const DEFAULT_COMPLETION_TARGET: CompletionTarget = "channel";
const DEFAULT_STORE_DATA: StoreData = {
  tasks: [],
  settings: {},
  users: {},
};

type StoreMode = "file" | "mongo";

interface MongoState {
  client: MongoClient;
  db: Db;
  tasks: Collection<Task>;
  settings: Collection<ConversationSettings>;
  users: Collection<UserProfile>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeTaskId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTaskId(value: string): string {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^"(.+)"$/);
  return quoted ? quoted[1] : trimmed;
}

function conversationKindFromId(conversationId: string): ConversationKind {
  if (conversationId.startsWith("D")) {
    return "dm";
  }

  if (conversationId.startsWith("G")) {
    return "group_dm";
  }

  if (conversationId.startsWith("C")) {
    return "channel";
  }

  return "unknown";
}

function inferScope(
  conversationKind: ConversationKind,
  createdBy: string,
  assignee: string | null,
): TaskScope {
  if (conversationKind === "channel" || conversationKind === "group_dm") {
    return "channel";
  }

  if (assignee && assignee === createdBy) {
    return "self";
  }

  return "dm";
}

function defaultTaskSource(kind: TaskSourceKind = "slash_command"): TaskSource {
  return {
    kind,
    sourceMessageTs: null,
  };
}

function normalizeRecurrence(input: TaskRecurrence | null | undefined): TaskRecurrence | null {
  if (!input) {
    return null;
  }

  const cadence = input.cadence ?? "weekly";
  const interval = Number.isFinite(input.interval) && input.interval > 0 ? input.interval : 1;

  return {
    enabled: Boolean(input.enabled),
    cadence,
    interval,
    timezone: input.timezone ?? null,
    nextRunAt: input.nextRunAt ?? null,
  };
}

function normalizeTask(raw: {
  id: string;
  title: string;
  createdBy: string;
  assignee?: string | null;
  conversationId: string;
  conversationKind?: ConversationKind;
  scope?: TaskScope;
  done?: boolean;
  createdAt?: string;
  updatedAt?: string;
  doneAt?: string | null;
  doneBy?: string | null;
  messageTs?: string | null;
  discussionStartedAt?: string | null;
  recurrence?: TaskRecurrence | null;
  source?: TaskSource;
}): Task {
  const conversationKind = raw.conversationKind ?? conversationKindFromId(raw.conversationId);
  const assignee = raw.assignee ?? null;

  return {
    id: raw.id,
    title: raw.title,
    createdBy: raw.createdBy,
    assignee,
    conversationId: raw.conversationId,
    conversationKind,
    scope: raw.scope ?? inferScope(conversationKind, raw.createdBy, assignee),
    done: Boolean(raw.done),
    createdAt: raw.createdAt ?? nowIso(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? nowIso(),
    doneAt: raw.doneAt ?? null,
    doneBy: raw.doneBy ?? null,
    messageTs: raw.messageTs ?? null,
    discussionStartedAt: raw.discussionStartedAt ?? null,
    recurrence: normalizeRecurrence(raw.recurrence),
    source: raw.source ?? defaultTaskSource(),
  };
}

function normalizeConversationSettings(
  input: Partial<ConversationSettings> & { conversationId: string },
): ConversationSettings {
  return {
    conversationId: input.conversationId,
    postCompletionUpdate: Boolean(input.postCompletionUpdate),
    completionTarget: input.completionTarget ?? DEFAULT_COMPLETION_TARGET,
    updatedAt: input.updatedAt ?? nowIso(),
  };
}

function emptyUserStats(): UserStats {
  return {
    tasksCreated: 0,
    tasksCompleted: 0,
    tasksAssigned: 0,
    tasksEdited: 0,
  };
}

function defaultUserPreferences(): UserPreferences {
  return {
    timezone: null,
    defaultCompletionTarget: null,
    defaultTaskScope: null,
  };
}

function normalizeUserProfile(input: Partial<UserProfile> & { userId: string }): UserProfile {
  return {
    userId: input.userId,
    firstSeenAt: input.firstSeenAt ?? nowIso(),
    lastSeenAt: input.lastSeenAt ?? nowIso(),
    lastConversationId: input.lastConversationId ?? null,
    lastConversationKind: input.lastConversationKind ?? null,
    lastAction: input.lastAction ?? "unknown",
    stats: {
      ...emptyUserStats(),
      ...(input.stats ?? {}),
    },
    preferences: {
      ...defaultUserPreferences(),
      ...(input.preferences ?? {}),
    },
  };
}

function parseDbNameFromMongoUri(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    const pathName = parsed.pathname.replace(/^\//, "").trim();
    if (!pathName) {
      return null;
    }

    return pathName.split("/")[0] || null;
  } catch {
    return null;
  }
}

export class TodoStore {
  private readonly filePath: string;
  private readonly mongoUri?: string;
  private readonly mongoDbName?: string;
  private mode: StoreMode = "file";
  private data: StoreData | null = null;
  private mongo: MongoState | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(input: { filePath: string; mongoUri?: string; mongoDbName?: string }) {
    this.filePath = input.filePath;
    this.mongoUri = input.mongoUri;
    this.mongoDbName = input.mongoDbName;
  }

  async init(): Promise<void> {
    await this.enqueue(async () => {
      const mongoReady = await this.tryInitMongo();
      if (mongoReady) {
        return;
      }

      await this.ensureFile();
      this.data = await this.readFile();
      console.log(`[store] using local file persistence (${this.filePath})`);
    });
  }

  async createTask(input: {
    title: string;
    createdBy: string;
    assignee: string | null;
    conversationId: string;
    source?: TaskSource | TaskSourceKind;
    recurrence?: TaskRecurrence | null;
  }): Promise<Task> {
    return this.enqueue(async () => {
      const timestamp = nowIso();
      const conversationKind = conversationKindFromId(input.conversationId);
      const assignee = input.assignee ?? null;
      const source =
        typeof input.source === "string"
          ? defaultTaskSource(input.source)
          : (input.source ?? defaultTaskSource());

      const task = normalizeTask({
        id: makeTaskId(),
        title: input.title,
        createdBy: input.createdBy,
        assignee,
        conversationId: input.conversationId,
        conversationKind,
        scope: inferScope(conversationKind, input.createdBy, assignee),
        done: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        doneAt: null,
        doneBy: null,
        messageTs: null,
        discussionStartedAt: null,
        recurrence: input.recurrence ?? null,
        source,
      });

      if (this.mode === "mongo" && this.mongo) {
        await this.mongo.tasks.insertOne(task);
        await this.recordUserActivityMongo(
          {
            userId: task.createdBy,
            conversationId: task.conversationId,
            action: "task_created",
          },
          { tasksCreated: 1 },
        );

        if (task.assignee) {
          await this.recordUserActivityMongo(
            {
              userId: task.assignee,
              conversationId: task.conversationId,
              action: "task_assigned",
            },
            { tasksAssigned: 1 },
          );
        }

        return { ...task };
      }

      const data = await this.getData();
      data.tasks.push(task);
      this.recordUserActivityFile(
        data,
        {
          userId: task.createdBy,
          conversationId: task.conversationId,
          action: "task_created",
        },
        { tasksCreated: 1 },
      );

      if (task.assignee) {
        this.recordUserActivityFile(
          data,
          {
            userId: task.assignee,
            conversationId: task.conversationId,
            action: "task_assigned",
          },
          { tasksAssigned: 1 },
        );
      }

      await this.persist(data);
      return { ...task };
    });
  }

  async getTask(taskId: string): Promise<Task | null> {
    return this.enqueue(async () => {
      const normalizedTaskId = normalizeTaskId(taskId);

      if (this.mode === "mongo" && this.mongo) {
        const task = await this.mongo.tasks.findOne({ id: normalizedTaskId });
        return task ? normalizeTask(task) : null;
      }

      const data = await this.getData();
      const task = data.tasks.find((item) => item.id === normalizedTaskId);
      return task ? { ...task } : null;
    });
  }

  async listTasks(filter: TaskFilter = {}): Promise<Task[]> {
    return this.enqueue(async () => {
      if (this.mode === "mongo" && this.mongo) {
        const participants = filter.participants ?? [];
        const query: Record<string, unknown> = {};

        if (filter.conversationId) {
          query.conversationId = filter.conversationId;
        }

        if (!filter.includeDone) {
          query.done = false;
        }

        if (filter.scopes && filter.scopes.length > 0) {
          query.scope = { $in: filter.scopes };
        }

        if (participants.length > 0) {
          query.$and = participants.map((participant) => ({
            $or: [{ createdBy: participant }, { assignee: participant }],
          }));
        }

        const tasks = await this.mongo.tasks.find(query).sort({ done: 1, updatedAt: -1 }).toArray();

        return tasks.map((task) => normalizeTask(task));
      }

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

          if (filter.scopes && filter.scopes.length > 0 && !filter.scopes.includes(task.scope)) {
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
      const normalizedTaskId = normalizeTaskId(taskId);

      if (this.mode === "mongo" && this.mongo) {
        const task = await this.mongo.tasks.findOne({ id: normalizedTaskId });
        if (!task) {
          return { task: null, changed: false };
        }

        const existing = normalizeTask(task);
        const changed = existing.done !== done;
        if (!changed) {
          return { task: existing, changed: false };
        }

        const updatedAt = nowIso();
        const doneAt = done ? updatedAt : null;
        const doneBy = done ? actorId : null;

        await this.mongo.tasks.updateOne(
          { id: normalizedTaskId },
          {
            $set: {
              done,
              updatedAt,
              doneAt,
              doneBy,
            },
          },
        );

        const updatedTask = {
          ...existing,
          done,
          updatedAt,
          doneAt,
          doneBy,
        };

        if (done) {
          await this.recordUserActivityMongo(
            {
              userId: actorId,
              conversationId: updatedTask.conversationId,
              action: "task_completed",
            },
            { tasksCompleted: 1 },
          );
        }

        return { task: updatedTask, changed: true };
      }

      const data = await this.getData();
      const task = data.tasks.find((item) => item.id === normalizedTaskId);

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

      if (done) {
        this.recordUserActivityFile(
          data,
          {
            userId: actorId,
            conversationId: task.conversationId,
            action: "task_completed",
          },
          { tasksCompleted: 1 },
        );
      }

      await this.persist(data);
      return { task: { ...task }, changed: true };
    });
  }

  async updateTaskMetadata(
    taskId: string,
    updates: { messageTs?: string | null; discussionStartedAt?: string | null },
  ): Promise<Task | null> {
    return this.enqueue(async () => {
      const normalizedTaskId = normalizeTaskId(taskId);

      if (this.mode === "mongo" && this.mongo) {
        const task = await this.mongo.tasks.findOne({ id: normalizedTaskId });
        if (!task) {
          return null;
        }

        const set: Record<string, unknown> = {
          updatedAt: nowIso(),
        };

        if (Object.prototype.hasOwnProperty.call(updates, "messageTs")) {
          set.messageTs = updates.messageTs ?? null;
        }

        if (Object.prototype.hasOwnProperty.call(updates, "discussionStartedAt")) {
          set.discussionStartedAt = updates.discussionStartedAt ?? null;
        }

        await this.mongo.tasks.updateOne(
          { id: normalizedTaskId },
          {
            $set: set,
          },
        );

        return {
          ...normalizeTask(task),
          ...set,
        } as Task;
      }

      const data = await this.getData();
      const task = data.tasks.find((item) => item.id === normalizedTaskId);

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

  async updateTask(
    taskId: string,
    updates: { title: string; assignee: string | null; actorId?: string },
  ): Promise<Task | null> {
    return this.enqueue(async () => {
      const normalizedTaskId = normalizeTaskId(taskId);

      if (this.mode === "mongo" && this.mongo) {
        const existing = await this.mongo.tasks.findOne({ id: normalizedTaskId });
        if (!existing) {
          return null;
        }

        const current = normalizeTask(existing);
        const nextAssignee = updates.assignee ?? null;
        const nextScope = inferScope(current.conversationKind, current.createdBy, nextAssignee);
        const updatedAt = nowIso();

        await this.mongo.tasks.updateOne(
          { id: normalizedTaskId },
          {
            $set: {
              title: updates.title,
              assignee: nextAssignee,
              scope: nextScope,
              updatedAt,
            },
          },
        );

        if (updates.actorId) {
          await this.recordUserActivityMongo(
            {
              userId: updates.actorId,
              conversationId: current.conversationId,
              action: "task_edited",
            },
            { tasksEdited: 1 },
          );
        }

        if (nextAssignee && nextAssignee !== current.assignee) {
          await this.recordUserActivityMongo(
            {
              userId: nextAssignee,
              conversationId: current.conversationId,
              action: "task_assigned",
            },
            { tasksAssigned: 1 },
          );
        }

        return {
          ...current,
          title: updates.title,
          assignee: nextAssignee,
          scope: nextScope,
          updatedAt,
        };
      }

      const data = await this.getData();
      const task = data.tasks.find((item) => item.id === normalizedTaskId);

      if (!task) {
        return null;
      }

      const previousAssignee = task.assignee;
      task.title = updates.title;
      task.assignee = updates.assignee ?? null;
      task.scope = inferScope(task.conversationKind, task.createdBy, task.assignee);
      task.updatedAt = nowIso();

      if (updates.actorId) {
        this.recordUserActivityFile(
          data,
          {
            userId: updates.actorId,
            conversationId: task.conversationId,
            action: "task_edited",
          },
          { tasksEdited: 1 },
        );
      }

      if (task.assignee && task.assignee !== previousAssignee) {
        this.recordUserActivityFile(
          data,
          {
            userId: task.assignee,
            conversationId: task.conversationId,
            action: "task_assigned",
          },
          { tasksAssigned: 1 },
        );
      }

      await this.persist(data);
      return { ...task };
    });
  }

  async getConversationSettings(conversationId: string): Promise<ConversationSettings> {
    return this.enqueue(async () => {
      if (this.mode === "mongo" && this.mongo) {
        const existing = await this.mongo.settings.findOne({ conversationId });
        if (existing) {
          return normalizeConversationSettings(existing);
        }

        return normalizeConversationSettings({
          conversationId,
          postCompletionUpdate: false,
          completionTarget: DEFAULT_COMPLETION_TARGET,
        });
      }

      const data = await this.getData();
      const existing = data.settings[conversationId];

      if (existing) {
        return { ...existing };
      }

      return normalizeConversationSettings({
        conversationId,
        postCompletionUpdate: false,
        completionTarget: DEFAULT_COMPLETION_TARGET,
      });
    });
  }

  async upsertConversationSettings(
    conversationId: string,
    updates: { postCompletionUpdate: boolean; completionTarget: CompletionTarget },
  ): Promise<ConversationSettings> {
    return this.enqueue(async () => {
      const next = normalizeConversationSettings({
        conversationId,
        postCompletionUpdate: updates.postCompletionUpdate,
        completionTarget: updates.completionTarget,
        updatedAt: nowIso(),
      });

      if (this.mode === "mongo" && this.mongo) {
        await this.mongo.settings.updateOne(
          { conversationId },
          {
            $set: next,
            $setOnInsert: {
              conversationId,
            },
          },
          { upsert: true },
        );

        return next;
      }

      const data = await this.getData();
      data.settings[conversationId] = next;
      await this.persist(data);
      return { ...next };
    });
  }

  async trackUserActivity(input: TrackUserActivityInput): Promise<void> {
    return this.enqueue(async () => {
      if (!input.userId) {
        return;
      }

      if (this.mode === "mongo" && this.mongo) {
        await this.recordUserActivityMongo(input);
        return;
      }

      const data = await this.getData();
      this.recordUserActivityFile(data, input);
      await this.persist(data);
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

  private async tryInitMongo(): Promise<boolean> {
    if (!this.mongoUri) {
      return false;
    }

    const dbName = this.mongoDbName || parseDbNameFromMongoUri(this.mongoUri) || "ticky";
    const client = new MongoClient(this.mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });

    try {
      await client.connect();
      const db = client.db(dbName);

      this.mongo = {
        client,
        db,
        tasks: db.collection<Task>("tasks"),
        settings: db.collection<ConversationSettings>("conversation_settings"),
        users: db.collection<UserProfile>("users"),
      };
      this.mode = "mongo";

      await this.ensureMongoIndexes();
      await this.migrateFileDataToMongoIfNeeded();

      console.log(`[store] using MongoDB persistence (db=${dbName})`);
      return true;
    } catch (error) {
      console.error("[store] failed to initialize MongoDB, falling back to file store", error);
      this.mongo = null;
      this.mode = "file";

      try {
        await client.close();
      } catch {
        // no-op
      }

      return false;
    }
  }

  private async ensureMongoIndexes(): Promise<void> {
    if (!this.mongo) {
      return;
    }

    await Promise.all([
      this.mongo.tasks.createIndex({ id: 1 }, { unique: true }),
      this.mongo.tasks.createIndex({ conversationId: 1, updatedAt: -1 }),
      this.mongo.tasks.createIndex({ assignee: 1, done: 1, updatedAt: -1 }),
      this.mongo.tasks.createIndex({ scope: 1, updatedAt: -1 }),
      this.mongo.tasks.createIndex({ "recurrence.enabled": 1, "recurrence.nextRunAt": 1 }),
      this.mongo.settings.createIndex({ conversationId: 1 }, { unique: true }),
      this.mongo.users.createIndex({ userId: 1 }, { unique: true }),
    ]);
  }

  private async migrateFileDataToMongoIfNeeded(): Promise<void> {
    if (!this.mongo) {
      return;
    }

    await this.ensureFile();
    const fileData = await this.readFile();

    const normalizedTasks = fileData.tasks.map((task) => normalizeTask(task));
    const normalizedSettings = Object.values(fileData.settings).map((setting) =>
      normalizeConversationSettings(setting),
    );
    const normalizedUsers = Object.values(fileData.users).map((user) => normalizeUserProfile(user));

    if (
      normalizedTasks.length === 0 &&
      normalizedSettings.length === 0 &&
      normalizedUsers.length === 0
    ) {
      return;
    }

    let inserted = 0;

    if (normalizedTasks.length > 0) {
      const taskResult = await this.mongo.tasks.bulkWrite(
        normalizedTasks.map((task) => ({
          updateOne: {
            filter: { id: task.id },
            update: { $setOnInsert: task },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      inserted += taskResult.upsertedCount;
    }

    if (normalizedSettings.length > 0) {
      const settingResult = await this.mongo.settings.bulkWrite(
        normalizedSettings.map((setting) => ({
          updateOne: {
            filter: { conversationId: setting.conversationId },
            update: { $setOnInsert: setting },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      inserted += settingResult.upsertedCount;
    }

    if (normalizedUsers.length > 0) {
      const userResult = await this.mongo.users.bulkWrite(
        normalizedUsers.map((user) => ({
          updateOne: {
            filter: { userId: user.userId },
            update: { $setOnInsert: user },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      inserted += userResult.upsertedCount;
    }

    if (inserted > 0) {
      console.log(`[store] merged ${inserted} local records into MongoDB`);
    }
  }

  private recordUserActivityFile(
    data: StoreData,
    input: TrackUserActivityInput,
    statsDelta?: Partial<UserStats>,
  ): void {
    const existing = data.users[input.userId] ?? normalizeUserProfile({ userId: input.userId });
    const timestamp = nowIso();

    const next: UserProfile = {
      ...existing,
      lastSeenAt: timestamp,
      lastAction: input.action,
      lastConversationId: input.conversationId ?? existing.lastConversationId,
      lastConversationKind: input.conversationId
        ? conversationKindFromId(input.conversationId)
        : existing.lastConversationKind,
      stats: {
        ...existing.stats,
      },
    };

    if (statsDelta?.tasksCreated) {
      next.stats.tasksCreated += statsDelta.tasksCreated;
    }

    if (statsDelta?.tasksCompleted) {
      next.stats.tasksCompleted += statsDelta.tasksCompleted;
    }

    if (statsDelta?.tasksAssigned) {
      next.stats.tasksAssigned += statsDelta.tasksAssigned;
    }

    if (statsDelta?.tasksEdited) {
      next.stats.tasksEdited += statsDelta.tasksEdited;
    }

    data.users[input.userId] = next;
  }

  private async recordUserActivityMongo(
    input: TrackUserActivityInput,
    statsDelta?: Partial<UserStats>,
  ): Promise<void> {
    if (!this.mongo || !input.userId) {
      return;
    }

    const timestamp = nowIso();
    const set: Record<string, unknown> = {
      lastSeenAt: timestamp,
      lastAction: input.action,
    };

    if (input.conversationId) {
      set.lastConversationId = input.conversationId;
      set.lastConversationKind = conversationKindFromId(input.conversationId);
    }

    const inc: Record<string, number> = {};
    if (statsDelta?.tasksCreated) {
      inc["stats.tasksCreated"] = statsDelta.tasksCreated;
    }

    if (statsDelta?.tasksCompleted) {
      inc["stats.tasksCompleted"] = statsDelta.tasksCompleted;
    }

    if (statsDelta?.tasksAssigned) {
      inc["stats.tasksAssigned"] = statsDelta.tasksAssigned;
    }

    if (statsDelta?.tasksEdited) {
      inc["stats.tasksEdited"] = statsDelta.tasksEdited;
    }

    const update: Record<string, unknown> = {
      $set: set,
      $setOnInsert: {
        ...normalizeUserProfile({ userId: input.userId }),
      },
    };

    if (Object.keys(inc).length > 0) {
      update.$inc = inc;
    }

    await this.mongo.users.updateOne({ userId: input.userId }, update, { upsert: true });
  }

  private async ensureFile(): Promise<void> {
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true });

    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, JSON.stringify(DEFAULT_STORE_DATA, null, 2), "utf8");
    }
  }

  private async readFile(): Promise<StoreData> {
    const raw = await fs.readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreData>;

    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks
          .filter((item): item is Task => {
            return Boolean(
              item &&
              typeof item.id === "string" &&
              typeof item.title === "string" &&
              typeof item.createdBy === "string" &&
              typeof item.conversationId === "string",
            );
          })
          .map((task) => normalizeTask(task))
      : [];

    const settingsRecord =
      parsed.settings && typeof parsed.settings === "object" && !Array.isArray(parsed.settings)
        ? parsed.settings
        : {};
    const settings: Record<string, ConversationSettings> = {};
    for (const [conversationId, setting] of Object.entries(settingsRecord)) {
      if (!setting || typeof setting !== "object") {
        continue;
      }

      settings[conversationId] = normalizeConversationSettings({
        ...(setting as Partial<ConversationSettings>),
        conversationId,
      });
    }

    const usersRecord =
      parsed.users && typeof parsed.users === "object" && !Array.isArray(parsed.users)
        ? parsed.users
        : {};
    const users: Record<string, UserProfile> = {};
    for (const [userId, user] of Object.entries(usersRecord)) {
      if (!user || typeof user !== "object") {
        continue;
      }

      users[userId] = normalizeUserProfile({
        ...(user as Partial<UserProfile>),
        userId,
      });
    }

    return {
      tasks,
      settings,
      users,
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
