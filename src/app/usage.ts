export function usageText(): string {
  return [
    "Mini Task Manager Commands:",
    "• /todo add @user <task>    - create a task for someone",
    "• /todo add <task>           - create an unassigned task",
    "• /todo sub <task_id> [@user] <task> - add a sub-task",
    "• /todo done <task_id>       - mark a task/sub-task done",
    "• /todo reopen <task_id>     - reopen a task/sub-task",
    "  (Tip: use mention autocomplete in Slack)",
    "• /todo list [@user] [all]   - list open tasks in this conversation",
    "• /todo between <@u1> <@u2> [all] - list tasks involving two people",
    "• /todo settings             - configure completion update behavior",
    '• Message shortcut: "Add message to Ticky" - turn a DM message into a task',
    "• /todo help                 - show this help",
  ].join("\n");
}
