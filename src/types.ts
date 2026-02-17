export type CompletionTarget = "channel" | "dm_creator";
export type ConversationKind = "dm" | "group_dm" | "channel" | "unknown";
export type TaskScope = "self" | "dm" | "channel";
export type TaskSourceKind = "slash_command" | "message_shortcut" | "system";

export interface TaskRecurrence {
  enabled: boolean;
  cadence: "daily" | "weekly" | "monthly" | "custom";
  interval: number;
  timezone: string | null;
  nextRunAt: string | null;
}

export interface TaskSource {
  kind: TaskSourceKind;
  sourceMessageTs?: string | null;
}

export interface Task {
  id: string;
  title: string;
  createdBy: string;
  assignee: string | null;
  conversationId: string;
  conversationKind: ConversationKind;
  scope: TaskScope;
  done: boolean;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  doneBy: string | null;
  messageTs: string | null;
  discussionStartedAt: string | null;
  recurrence: TaskRecurrence | null;
  source: TaskSource;
}

export interface ConversationSettings {
  conversationId: string;
  postCompletionUpdate: boolean;
  completionTarget: CompletionTarget;
  updatedAt: string;
}

export interface UserStats {
  tasksCreated: number;
  tasksCompleted: number;
  tasksAssigned: number;
  tasksEdited: number;
}

export interface UserPreferences {
  timezone: string | null;
  defaultCompletionTarget: CompletionTarget | null;
  defaultTaskScope: TaskScope | null;
}

export interface UserProfile {
  userId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastConversationId: string | null;
  lastConversationKind: ConversationKind | null;
  lastAction: string;
  stats: UserStats;
  preferences: UserPreferences;
}

export interface StoreData {
  tasks: Task[];
  settings: Record<string, ConversationSettings>;
  users: Record<string, UserProfile>;
}

export interface TaskFilter {
  conversationId?: string;
  participants?: string[];
  includeDone?: boolean;
  scopes?: TaskScope[];
}

export interface TrackUserActivityInput {
  userId: string;
  conversationId: string | null;
  action: string;
}
