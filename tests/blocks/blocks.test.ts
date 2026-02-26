import { describe, expect, it } from "vitest";
import {
  buildCreateSubtaskModal,
  buildCreateTaskFromMessageModal,
  buildEditTaskModal,
  buildSettingsModal,
  buildTaskActions,
  buildTaskCardBlocks,
  buildTaskListBlocks,
  buildTaskSection,
  updateBlocksWithTaskState,
} from "../../src/blocks";
import { makeTask } from "../helpers/task-fixtures";

describe("blocks", () => {
  it("builds task section with escaped title and depth", () => {
    const task = makeTask({ title: "Fix <bug>&deploy" });
    const section = buildTaskSection(task, "task_section:test", 2) as any;

    expect(section.block_id).toBe("task_section:test");
    expect(section.text.text).toContain("Fix &lt;bug&gt;&amp;deploy");
    expect(section.text.text).toContain("↳ ↳");
  });

  it("builds task actions with correct toggle payload", () => {
    const openTask = makeTask({ done: false });
    const openActions = buildTaskActions(openTask, "actions") as any;
    expect(openActions.elements[0].text.text).toBe("Mark Done");
    expect(openActions.elements[0].style).toBe("primary");

    const doneTask = makeTask({ done: true, id: "task_2" });
    const doneActions = buildTaskActions(doneTask, "actions") as any;
    expect(doneActions.elements[0].text.text).toBe("Reopen");
    expect(doneActions.elements[0].style).toBe("danger");
    expect(JSON.parse(doneActions.elements[0].value)).toEqual({ taskId: "task_2", done: false });
  });

  it("builds task card blocks for parent and sub-task", () => {
    const parentCard = buildTaskCardBlocks(makeTask({ parentTaskId: null })) as any[];
    const subtaskCard = buildTaskCardBlocks(makeTask({ parentTaskId: "task_parent" })) as any[];

    expect(parentCard[0].text.text).toBe("Ticky Task");
    expect(subtaskCard[0].text.text).toBe("Ticky Sub-task");
    expect(subtaskCard[4].text).toBeUndefined();
    expect(subtaskCard[4].elements[0].text).toContain("Parent: task_parent");
  });

  it("builds empty and populated task list boards", () => {
    const empty = buildTaskListBlocks({ tasks: [], conversationId: "C1", title: "Todos" }) as any[];
    expect(empty.some((block) => block.block_id === "todo_list_controls")).toBe(true);
    expect(empty.some((block) => block.text?.text === "No matching todos found.")).toBe(true);

    const parent = makeTask({ id: "task_parent", title: "Parent", sortOrder: 1 });
    const child = makeTask({
      id: "task_child",
      title: "Child",
      parentTaskId: "task_parent",
      sortOrder: 1,
    });
    const done = makeTask({ id: "task_done", title: "Done", done: true, sortOrder: 2 });

    const board = buildTaskListBlocks({
      tasks: [done, child, parent],
      conversationId: "C1",
      title: "Team Todos",
      subtitle: "Showing open and completed",
    }) as any[];

    expect(board.some((block) => block.block_id === "task_section:task_parent")).toBe(true);
    expect(board.some((block) => block.block_id === "task_section:task_child")).toBe(true);
    expect(board.some((block) => block.type === "divider")).toBe(true);
  });

  it("updates task state blocks in place", () => {
    const task = makeTask({ id: "task_x", done: true, doneBy: "U9" });
    const existing = [
      { type: "section", block_id: "task_section:task_x", text: { type: "mrkdwn", text: "old" } },
      { type: "actions", block_id: "task_actions:task_x", elements: [] },
      { type: "context", block_id: "task_meta:task_x", elements: [] },
      { type: "context", block_id: "unrelated", elements: [] },
    ] as any[];

    const updated = updateBlocksWithTaskState(existing, task) as any[];

    expect(updated[0].text.text).toContain("Done");
    expect(updated[1].elements[0].text.text).toBe("Reopen");
    expect(updated[2].elements[0].text).toContain("Created by");
    expect(updated[3].block_id).toBe("unrelated");
  });

  it("builds settings/edit/subtask/message modals", () => {
    const settings = buildSettingsModal({
      conversationId: "C1",
      settings: {
        conversationId: "C1",
        postCompletionUpdate: true,
        completionTarget: "dm_creator",
        updatedAt: "2026-02-26T00:00:00.000Z",
      },
    }) as any;
    expect(settings.callback_id).toBe("todo_settings_modal");
    expect(settings.blocks[0].element.initial_options).toHaveLength(1);

    const edit = buildEditTaskModal({
      task: makeTask({ assignee: "U2", done: true }),
      sourceChannelId: "C1",
      sourceMessageTs: "111.222",
    }) as any;
    expect(edit.callback_id).toBe("todo_edit_task_modal");
    expect(edit.blocks[1].element.initial_user).toBe("U2");
    expect(edit.blocks[2].element.initial_options).toHaveLength(1);

    const subtask = buildCreateSubtaskModal({
      parentTask: makeTask({ id: "task_parent", title: "Parent <x>" }),
      sourceChannelId: "C1",
    }) as any;
    expect(subtask.callback_id).toBe("todo_create_subtask_modal");
    expect(subtask.blocks[0].elements[0].text).toContain("Parent &lt;x&gt;");

    const message = buildCreateTaskFromMessageModal({
      conversationId: "C1",
      messageText: "x".repeat(4000),
      defaultAssignee: "U5",
    }) as any;
    expect(message.callback_id).toBe("todo_message_to_task_modal");
    expect(message.blocks[2].element.initial_value.length).toBeLessThanOrEqual(2800);
    expect(message.blocks[4].element.initial_user).toBe("U5");
  });
});
