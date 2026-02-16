export type CompletionTarget = "channel" | "dm_creator";

export interface Task {
  id: string;
  title: string;
  createdBy: string;
  assignee: string | null;
  conversationId: string;
  done: boolean;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  doneBy: string | null;
  messageTs: string | null;
  discussionStartedAt: string | null;
}

export interface ConversationSettings {
  conversationId: string;
  postCompletionUpdate: boolean;
  completionTarget: CompletionTarget;
  updatedAt: string;
}

export interface StoreData {
  tasks: Task[];
  settings: Record<string, ConversationSettings>;
}

export interface TaskFilter {
  conversationId?: string;
  participants?: string[];
  includeDone?: boolean;
}
