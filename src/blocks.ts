import { Block, KnownBlock } from "@slack/types";
import { CompletionTarget, ConversationSettings, Task } from "./types";

function taskSummary(task: Task): string {
  const stateIcon = task.done ? ":white_check_mark:" : ":white_large_square:";
  const title = task.done ? `~${task.title}~` : task.title;
  const assignee = task.assignee ? `<@${task.assignee}>` : "Unassigned";

  return `${stateIcon} *${title}*\nAssignee: ${assignee} | Created by: <@${task.createdBy}>`;
}

function doneOption(taskId: string): { text: { type: "plain_text"; text: string }; value: string } {
  return {
    text: {
      type: "plain_text",
      text: "Done",
    },
    value: taskId,
  };
}

export function buildTaskSection(task: Task, blockId: string): KnownBlock {
  const option = doneOption(task.id);

  return {
    type: "section",
    block_id: blockId,
    text: {
      type: "mrkdwn",
      text: taskSummary(task),
    },
    accessory: {
      type: "checkboxes",
      action_id: "toggle_task",
      options: [option],
      ...(task.done ? { initial_options: [option] } : {}),
    },
  };
}

export function buildTaskActions(task: Task, blockId: string): KnownBlock {
  return {
    type: "actions",
    block_id: blockId,
    elements: [
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

export function buildTaskCardBlocks(task: Task): (KnownBlock | Block)[] {
  return [
    buildTaskSection(task, `task_card:${task.id}`),
    buildTaskActions(task, `task_card_actions:${task.id}`),
    {
      type: "context",
      block_id: `task_card_context:${task.id}`,
      elements: [
        {
          type: "mrkdwn",
          text: `Task ID: ${task.id} | Created: ${new Date(task.createdAt).toLocaleString()}`,
        },
      ],
    },
  ];
}

export function buildTaskListBlocks(input: {
  tasks: Task[];
  conversationId: string;
  title: string;
  subtitle?: string;
}): (KnownBlock | Block)[] {
  const blocks: (KnownBlock | Block)[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: input.title,
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

  for (const task of input.tasks) {
    blocks.push(buildTaskSection(task, `task_section:${task.id}`));
    blocks.push(buildTaskActions(task, `task_actions:${task.id}`));
    blocks.push({ type: "divider" });
  }

  return blocks;
}

export function updateBlocksWithTaskState(existingBlocks: (KnownBlock | Block)[], task: Task): (KnownBlock | Block)[] {
  return existingBlocks.map((block) => {
    const blockId = "block_id" in block ? block.block_id : undefined;

    if (blockId === `task_section:${task.id}`) {
      return buildTaskSection(task, `task_section:${task.id}`);
    }

    if (blockId === `task_actions:${task.id}`) {
      return buildTaskActions(task, `task_actions:${task.id}`);
    }

    if (blockId === `task_card:${task.id}`) {
      return buildTaskSection(task, `task_card:${task.id}`);
    }

    if (blockId === `task_card_actions:${task.id}`) {
      return buildTaskActions(task, `task_card_actions:${task.id}`);
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

  const targetOptions: Array<{ text: { type: "plain_text"; text: string }; value: CompletionTarget }> = [
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
          initial_option: targetOptions.find((option) => option.value === input.settings.completionTarget) ?? targetOptions[0],
        },
      },
    ],
  };
}
