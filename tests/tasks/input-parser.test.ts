import { describe, expect, it } from "vitest";
import { parseTaskGroupsFromText, splitFirstToken } from "../../src/tasks/input-parser";

describe("input parser", () => {
  it("splits first token and rest", () => {
    expect(splitFirstToken("  ")).toEqual({ first: null, rest: "" });
    expect(splitFirstToken("task_1 do this")).toEqual({ first: "task_1", rest: "do this" });
    expect(splitFirstToken("one")).toEqual({ first: "one", rest: "" });
  });

  it("parses plain text as single task", () => {
    const groups = parseTaskGroupsFromText("Follow up with design team");
    expect(groups).toEqual([{ text: "Follow up with design team", children: [] }]);
  });

  it("parses numbered and nested list tasks", () => {
    const input = [
      "1. Parent A",
      "a. Child A1",
      "b) Child A2",
      "2) Parent B:",
      "  - Child B1",
      "continuation line",
    ].join("\n");

    const groups = parseTaskGroupsFromText(input);
    expect(groups).toEqual([
      { text: "Parent A", children: ["Child A1", "Child A2"] },
      { text: "Parent B", children: ["Child B1 continuation line"] },
    ]);
  });

  it("ignores empty lines and supports CRLF/tab normalization", () => {
    const input = "- Parent\r\n\t- Child\r\n";
    const groups = parseTaskGroupsFromText(input);
    expect(groups).toEqual([{ text: "Parent", children: ["Child"] }]);
  });
});
