import { Task } from "../../src/types";

export function makeTask(overrides: Partial<Task> = {}): Task {
  const now = "2026-02-26T00:00:00.000Z";

  return {
    id: "task_test_1",
    title: "Default task",
    createdBy: "UCREATOR",
    assignee: null,
    parentTaskId: null,
    sortOrder: 1,
    conversationId: "C123",
    conversationKind: "channel",
    scope: "channel",
    done: false,
    createdAt: now,
    updatedAt: now,
    doneAt: null,
    doneBy: null,
    messageTs: "111.222",
    discussionStartedAt: null,
    recurrence: null,
    source: {
      kind: "slash_command",
      sourceMessageTs: null,
    },
    ...overrides,
  };
}
