# Command Reference

Primary command: `/todo`

## Help

```text
/todo help
```

Shows command usage.

## Add task

```text
/todo add <task title>
/todo add @user <task title>
```

Behavior:
- If assignee is omitted, task is unassigned.
- If mention is provided, task is assigned to that user.

Examples:

```text
/todo add Prepare weekly metrics
/todo add @Aman Kumar Nirala Prepare weekly metrics
```

## Add sub-task

```text
/todo sub <task_id> <sub-task title>
/todo sub <task_id> @user <sub-task title>
```

Examples:

```text
/todo sub task_abc123 Draft section 1
/todo sub task_abc123 @Aman Kumar Nirala Draft section 1
```

## Mark done / reopen

```text
/todo done <task_id>
/todo reopen <task_id>
```

## List tasks in current conversation

```text
/todo list
/todo list all
/todo list @user
/todo list @user all
```

Notes:
- `all` includes completed tasks.
- Without `all`, only open tasks are shown.

## List tasks involving two people

```text
/todo between <@user1> <@user2>
/todo between <@user1> <@user2> all
```

## Open settings

```text
/todo settings
```

Opens modal to configure completion update behavior.

## Message shortcut

From any message in DM/channel:
- Open message actions
- Click `Add message to Ticky`

The modal can parse multiple tasks from a structured list.
