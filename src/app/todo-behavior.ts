import { CompletionTarget } from "../types";

export function formatListTitle(participants: string[]): string {
  if (participants.length === 2) {
    return `Todos between <@${participants[0]}> and <@${participants[1]}>`;
  }
  if (participants.length === 1) {
    return `Todos involving <@${participants[0]}>`;
  }
  return "Todos in this conversation";
}

export function normalizeCompletionTarget(value: string | undefined): CompletionTarget {
  return value === "dm_creator" ? "dm_creator" : "channel";
}

export function commandErrorMessage(error: unknown): string {
  const slackError = error as { data?: { error?: string } };
  const storeError = error as { code?: string };
  const code = slackError?.data?.error;
  const storeCode = storeError?.code;

  if (storeCode === "parent_task_not_found") {
    return "Parent task was not found. Use `/todo list all` and copy a valid Task ID.";
  }

  if (storeCode === "parent_task_mismatch") {
    return "Parent task belongs to a different conversation. Create the sub-task where the parent exists.";
  }

  if (code === "channel_not_found") {
    return "I can't post in this conversation. Use a DM with Ticky or invite @Ticky to the channel.";
  }

  if (code === "invalid_blocks" || code === "invalid_arguments") {
    return "I couldn't format that task text for Slack. Try again with a simpler task title.";
  }

  return "Something failed while handling the command. Check app logs.";
}
