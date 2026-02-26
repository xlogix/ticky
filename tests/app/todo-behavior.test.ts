import { describe, expect, it } from "vitest";
import {
  commandErrorMessage,
  formatListTitle,
  normalizeCompletionTarget,
} from "../../src/app/todo-behavior";

describe("todo-behavior", () => {
  it("formats list title by participant count", () => {
    expect(formatListTitle([])).toBe("Todos in this conversation");
    expect(formatListTitle(["U1"])).toBe("Todos involving <@U1>");
    expect(formatListTitle(["U1", "U2"])).toBe("Todos between <@U1> and <@U2>");
  });

  it("normalizes completion target safely", () => {
    expect(normalizeCompletionTarget("dm_creator")).toBe("dm_creator");
    expect(normalizeCompletionTarget("channel")).toBe("channel");
    expect(normalizeCompletionTarget(undefined)).toBe("channel");
    expect(normalizeCompletionTarget("anything_else")).toBe("channel");
  });

  it("maps known command errors to user-friendly messages", () => {
    expect(commandErrorMessage({ code: "parent_task_not_found" })).toContain(
      "Parent task was not found",
    );
    expect(commandErrorMessage({ code: "parent_task_mismatch" })).toContain(
      "Parent task belongs to a different conversation",
    );
    expect(commandErrorMessage({ data: { error: "channel_not_found" } })).toContain(
      "can't post",
    );
    expect(commandErrorMessage({ data: { error: "invalid_blocks" } })).toContain(
      "couldn't format",
    );
    expect(commandErrorMessage({ data: { error: "invalid_arguments" } })).toContain(
      "couldn't format",
    );
    expect(commandErrorMessage(new Error("boom"))).toContain("Something failed");
  });
});
