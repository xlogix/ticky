import { Block, KnownBlock } from "@slack/types";
import { CompletionTarget, ConversationSettings, Task } from "./types";

function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function statusLabel(task: Task): string {
  if (!task.done) {
    return ":large_blue_circle: *Open*";
  }

  if (task.doneBy) {
    return `:white_check_mark: *Done* by <@${task.doneBy}>`;
  }

  return ":white_check_mark: *Done*";
}

function assigneeLabel(task: Task): string {
  return task.assignee ? `<@${task.assignee}>` : "Unassigned";
}

function taskSummary(task: Task, depth = 0): string {
  const safeTitle = escapeMrkdwn(task.title);
  const prefix = depth > 0 ? `${"↳ ".repeat(Math.min(depth, 3))}` : "";
  const title = task.done ? `~${prefix}${safeTitle}~` : `${prefix}${safeTitle}`;
  const typeLabel = task.parentTaskId ? "Sub-task" : "Task";

  return [
    `*${title}*`,
    `${statusLabel(task)}  •  ${typeLabel}  •  Assignee: ${assigneeLabel(task)}`,
  ].join("\n");
}

function doneOption(taskId: string): {
  text: { type: "plain_text"; text: string };
  value: string;
} {
  return {
    text: {
      type: "plain_text",
      text: "Done",
    },
    value: taskId,
  };
}

export function buildTaskSection(task: Task, blockId: string, depth = 0): KnownBlock {
  return {
    type: "section",
    block_id: blockId,
    text: {
      type: "mrkdwn",
      text: taskSummary(task, depth),
    },
  };
}

function buildTaskMetaContext(task: Task, blockId: string): KnownBlock {
  return {
    type: "context",
    block_id: blockId,
    elements: [
      {
        type: "mrkdwn",
        text: `Created by <@${task.createdBy}> • Updated ${new Date(task.updatedAt).toLocaleString()}`,
      },
    ],
  };
}

export function buildTaskActions(task: Task, blockId: string): KnownBlock {
  const togglePayload = JSON.stringify({
    taskId: task.id,
    done: !task.done,
  });

  return {
    type: "actions",
    block_id: blockId,
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: task.done ? "Reopen" : "Mark Done",
        },
        action_id: "toggle_task_button",
        value: togglePayload,
        ...(task.done ? { style: "danger" } : { style: "primary" }),
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Edit",
        },
        action_id: "edit_task",
        value: task.id,
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Add Sub-task",
        },
        action_id: "add_subtask",
        value: task.id,
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "Discuss",
        },
        action_id: "discuss_task",
        value: task.id,
      },
    ],
  };
}

function buildTaskCardContext(task: Task): KnownBlock {
  const parentContext = task.parentTaskId ? ` • Parent: ${task.parentTaskId}` : "";
  return {
    type: "context",
    block_id: `task_card_context:${task.id}`,
    elements: [
      {
        type: "mrkdwn",
        text: `Task ID: ${task.id}${parentContext} • Created ${new Date(task.createdAt).toLocaleString()}`,
      },
    ],
  };
}

export function buildTaskCardBlocks(task: Task): (KnownBlock | Block)[] {
  return [
    {
      type: "header",
      block_id: `task_card_header:${task.id}`,
      text: {
        type: "plain_text",
        text: task.parentTaskId ? "Ticky Sub-task" : "Ticky Task",
      },
    },
    buildTaskSection(task, `task_card:${task.id}`),
    buildTaskMetaContext(task, `task_card_meta:${task.id}`),
    buildTaskActions(task, `task_card_actions:${task.id}`),
    buildTaskCardContext(task),
  ];
}

export function buildTaskListBlocks(input: {
  tasks: Task[];
  conversationId: string;
  title: string;
  subtitle?: string;
}): (KnownBlock | Block)[] {
  type TaskTreeNode = {
    task: Task;
    children: TaskTreeNode[];
  };

  const sortForBoard = (tasks: Task[]): Task[] => {
    return [...tasks].sort((left, right) => {
      if (left.done !== right.done) {
        return left.done ? 1 : -1;
      }
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder;
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    });
  };

  const buildTaskTree = (tasks: Task[]): TaskTreeNode[] => {
    const sorted = sortForBoard(tasks);
    const byId = new Map<string, TaskTreeNode>();
    const roots: TaskTreeNode[] = [];

    for (const task of sorted) {
      byId.set(task.id, { task, children: [] });
    }

    for (const task of sorted) {
      const node = byId.get(task.id);
      if (!node) {
        continue;
      }

      if (!task.parentTaskId) {
        roots.push(node);
        continue;
      }

      const parent = byId.get(task.parentTaskId);
      if (!parent) {
        roots.push(node);
        continue;
      }

      parent.children.push(node);
    }

    return roots;
  };

  const appendTreeBlocks = (
    blocks: (KnownBlock | Block)[],
    node: TaskTreeNode,
    depth: number,
  ): void => {
    blocks.push(buildTaskSection(node.task, `task_section:${node.task.id}`, depth));
    blocks.push(buildTaskMetaContext(node.task, `task_meta:${node.task.id}`));
    blocks.push(buildTaskActions(node.task, `task_actions:${node.task.id}`));

    for (const child of node.children) {
      appendTreeBlocks(blocks, child, depth + 1);
    }
  };

  const blocks: (KnownBlock | Block)[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Ticky Todo Board",
      },
    },
    {
      type: "section",
      block_id: "todo_list_title",
      text: {
        type: "mrkdwn",
        text: `*${escapeMrkdwn(input.title)}*`,
      },
    },
  ];

  if (input.subtitle) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: input.subtitle,
        },
      ],
    });
  }

  blocks.push({
    type: "actions",
    block_id: "todo_list_controls",
    elements: [
      {
        type: "button",
        action_id: "open_todo_settings",
        text: {
          type: "plain_text",
          text: "Settings",
        },
        value: input.conversationId,
      },
      {
        type: "button",
        action_id: "message_to_task_help",
        text: {
          type: "plain_text",
          text: "Message -> Task",
        },
        value: input.conversationId,
      },
    ],
  });

  if (input.tasks.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "No matching todos found.",
      },
    });
    return blocks;
  }

  const roots = buildTaskTree(input.tasks);
  for (const root of roots) {
    appendTreeBlocks(blocks, root, 0);
    blocks.push({ type: "divider" });
  }

  return blocks;
}

export function updateBlocksWithTaskState(
  existingBlocks: (KnownBlock | Block)[],
  task: Task,
): (KnownBlock | Block)[] {
  return existingBlocks.map((block) => {
    const blockId = "block_id" in block ? block.block_id : undefined;

    if (blockId === `task_section:${task.id}`) {
      return buildTaskSection(task, `task_section:${task.id}`);
    }

    if (blockId === `task_actions:${task.id}`) {
      return buildTaskActions(task, `task_actions:${task.id}`);
    }

    if (blockId === `task_meta:${task.id}`) {
      return buildTaskMetaContext(task, `task_meta:${task.id}`);
    }

    if (blockId === `task_card:${task.id}`) {
      return buildTaskSection(task, `task_card:${task.id}`);
    }

    if (blockId === `task_card_meta:${task.id}`) {
      return buildTaskMetaContext(task, `task_card_meta:${task.id}`);
    }

    if (blockId === `task_card_actions:${task.id}`) {
      return buildTaskActions(task, `task_card_actions:${task.id}`);
    }

    if (blockId === `task_card_context:${task.id}`) {
      return buildTaskCardContext(task);
    }

    return block;
  });
}

export function buildSettingsModal(input: {
  conversationId: string;
  settings: ConversationSettings;
}): Record<string, unknown> {
  const updatesOption = {
    text: {
      type: "plain_text",
      text: "Send completion updates",
    },
    value: "enabled",
  };

  const targetOptions: Array<{
    text: { type: "plain_text"; text: string };
    value: CompletionTarget;
  }> = [
    {
      text: {
        type: "plain_text",
        text: "Post in this conversation",
      },
      value: "channel",
    },
    {
      text: {
        type: "plain_text",
        text: "DM the task creator",
      },
      value: "dm_creator",
    },
  ];

  return {
    type: "modal",
    callback_id: "todo_settings_modal",
    private_metadata: JSON.stringify({ conversationId: input.conversationId }),
    title: {
      type: "plain_text",
      text: "Todo Settings",
    },
    submit: {
      type: "plain_text",
      text: "Save",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
    },
    blocks: [
      {
        type: "input",
        block_id: "settings_updates",
        optional: true,
        label: {
          type: "plain_text",
          text: "Completion updates",
        },
        element: {
          type: "checkboxes",
          action_id: "post_completion_update",
          options: [updatesOption],
          ...(input.settings.postCompletionUpdate ? { initial_options: [updatesOption] } : {}),
        },
      },
      {
        type: "input",
        block_id: "settings_target",
        label: {
          type: "plain_text",
          text: "Update destination",
        },
        element: {
          type: "static_select",
          action_id: "completion_target",
          options: targetOptions,
          initial_option:
            targetOptions.find((option) => option.value === input.settings.completionTarget) ??
            targetOptions[0],
        },
      },
    ],
  };
}

export function buildEditTaskModal(input: {
  task: Task;
  sourceChannelId?: string;
  sourceMessageTs?: string;
}): Record<string, unknown> {
  const done = doneOption("done");

  return {
    type: "modal",
    callback_id: "todo_edit_task_modal",
    private_metadata: JSON.stringify({
      taskId: input.task.id,
      sourceChannelId: input.sourceChannelId,
      sourceMessageTs: input.sourceMessageTs,
    }),
    title: {
      type: "plain_text",
      text: "Edit Task",
    },
    submit: {
      type: "plain_text",
      text: "Save",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
    },
    blocks: [
      {
        type: "input",
        block_id: "edit_title",
        label: {
          type: "plain_text",
          text: "Task title",
        },
        element: {
          type: "plain_text_input",
          action_id: "title",
          min_length: 1,
          initial_value: input.task.title,
          multiline: true,
        },
      },
      {
        type: "input",
        block_id: "edit_assignee",
        optional: true,
        label: {
          type: "plain_text",
          text: "Assignee",
        },
        element: {
          type: "users_select",
          action_id: "assignee",
          placeholder: {
            type: "plain_text",
            text: "Unassigned",
          },
          ...(input.task.assignee ? { initial_user: input.task.assignee } : {}),
        },
      },
      {
        type: "input",
        block_id: "edit_status",
        optional: true,
        label: {
          type: "plain_text",
          text: "Status",
        },
        element: {
          type: "checkboxes",
          action_id: "done",
          options: [done],
          ...(input.task.done ? { initial_options: [done] } : {}),
        },
      },
    ],
  };
}

export function buildCreateSubtaskModal(input: {
  parentTask: Task;
  sourceChannelId?: string;
  sourceMessageTs?: string;
}): Record<string, unknown> {
  return {
    type: "modal",
    callback_id: "todo_create_subtask_modal",
    private_metadata: JSON.stringify({
      parentTaskId: input.parentTask.id,
      sourceChannelId: input.sourceChannelId,
      sourceMessageTs: input.sourceMessageTs,
    }),
    title: {
      type: "plain_text",
      text: "Add Sub-task",
    },
    submit: {
      type: "plain_text",
      text: "Create",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
    },
    blocks: [
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Parent: *${escapeMrkdwn(input.parentTask.title)}* (${input.parentTask.id})`,
          },
        ],
      },
      {
        type: "input",
        block_id: "create_subtask_title",
        label: {
          type: "plain_text",
          text: "Sub-task title",
        },
        element: {
          type: "plain_text_input",
          action_id: "title",
          min_length: 1,
          placeholder: {
            type: "plain_text",
            text: "Add a specific next step",
          },
        },
      },
      {
        type: "input",
        block_id: "create_subtask_assignee",
        optional: true,
        label: {
          type: "plain_text",
          text: "Assignee",
        },
        element: {
          type: "users_select",
          action_id: "assignee",
          placeholder: {
            type: "plain_text",
            text: "Unassigned",
          },
        },
      },
    ],
  };
}

export function buildCreateTaskFromMessageModal(input: {
  conversationId: string;
  messageText: string;
  defaultAssignee: string | null;
}): Record<string, unknown> {
  const initialTitle = truncate(input.messageText.trim() || "Follow up on message", 2800);

  return {
    type: "modal",
    callback_id: "todo_message_to_task_modal",
    private_metadata: JSON.stringify({
      conversationId: input.conversationId,
    }),
    title: {
      type: "plain_text",
      text: "Message -> Task",
    },
    submit: {
      type: "plain_text",
      text: "Create",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
    },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Create a todo from this message*",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: truncate(`Source: ${escapeMrkdwn(input.messageText)}`, 2900),
          },
        ],
      },
      {
        type: "input",
        block_id: "create_title",
        label: {
          type: "plain_text",
          text: "Task title(s)",
        },
        element: {
          type: "plain_text_input",
          action_id: "title",
          min_length: 1,
          initial_value: initialTitle,
          multiline: true,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Tip: paste numbered or bulleted lists to create multiple tasks; nested `a./b./c.` lines become sub-tasks.",
          },
        ],
      },
      {
        type: "input",
        block_id: "create_assignee",
        optional: true,
        label: {
          type: "plain_text",
          text: "Assignee",
        },
        element: {
          type: "users_select",
          action_id: "assignee",
          placeholder: {
            type: "plain_text",
            text: "Unassigned",
          },
          ...(input.defaultAssignee ? { initial_user: input.defaultAssignee } : {}),
        },
      },
    ],
  };
}
