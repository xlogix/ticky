import { describe, expect, it } from "vitest";
import {
  extractTaskIdFromBlocks,
  normalizeTaskId,
  parseToggleButtonValue,
} from "../../src/tasks/id-helpers";

describe("id helpers", () => {
  it("parses toggle payload safely", () => {
    expect(parseToggleButtonValue(undefined)).toBeNull();
    expect(parseToggleButtonValue("not-json")).toBeNull();
    expect(parseToggleButtonValue('{"taskId":"t1"}')).toBeNull();
    expect(parseToggleButtonValue('{"taskId":"t1","done":true}')).toEqual({
      taskId: "t1",
      done: true,
    });
  });

  it("normalizes task id", () => {
    expect(normalizeTaskId(undefined)).toBeNull();
    expect(normalizeTaskId(" ")).toBeNull();
    expect(normalizeTaskId('"task_1"')).toBe("task_1");
    expect(normalizeTaskId("task_2")).toBe("task_2");
  });

  it("extracts task id from block ids and context text", () => {
    const fromBlockId = extractTaskIdFromBlocks([
      {
        block_id: "task_card:task_abc",
      },
    ]);
    expect(fromBlockId).toBe("task_abc");

    const fromContext = extractTaskIdFromBlocks([
      {
        block_id: "context",
        elements: [{ text: "Task ID: task_xyz • Created" }],
      },
    ]);
    expect(fromContext).toBe("task_xyz");

    expect(extractTaskIdFromBlocks(undefined)).toBeNull();
    expect(extractTaskIdFromBlocks([{ block_id: "other" }])).toBeNull();
  });
});
