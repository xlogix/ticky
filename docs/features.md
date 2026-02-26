# Features and Workflows

## Task lifecycle

1. Create task via `/todo add` or message shortcut
2. Track status via cards/list
3. Edit title/assignee/status using `Edit`
4. Mark done/reopen using card buttons or commands

## Interactive task card actions

Each task card includes:
- `Mark Done` / `Reopen`
- `Edit`
- `Add Sub-task`
- `Discuss`

## Discussion flow

- `Discuss` opens/starts a thread tied to the task card.
- If canonical card is missing, app recreates it first when possible.

## Message-to-task conversion

The message shortcut modal supports:
- Single free-text task
- Numbered/bulleted list to create multiple tasks
- Nested letter/bullet items as sub-tasks

Example input:

```text
1. Plan launch checklist
2. Draft launch email
   a. Draft internal version
   b. Draft external version
```

Result:
- 2 parent tasks
- 2 sub-tasks under task 2

Current guardrail:
- Max 40 tasks/sub-tasks per submission.

## Assignee resolution behavior

- Preferred: use Slack mention autocomplete in `/todo add @user <task>`.
- If no assignee is specified, tasks are unassigned.
- Plain `@name` parsing requires `users:read` scope.

## Completion notifications

Per conversation settings allow:
- Enable/disable completion updates
- Destination:
  - current conversation
  - DM task creator
