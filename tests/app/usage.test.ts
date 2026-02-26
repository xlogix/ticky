import { describe, expect, it } from "vitest";
import { usageText } from "../../src/app/usage";

describe("usageText", () => {
  it("returns help text with key commands", () => {
    const help = usageText();

    expect(help).toContain("/todo add");
    expect(help).toContain("/todo sub");
    expect(help).toContain("/todo done");
    expect(help).toContain("/todo reopen");
    expect(help).toContain("/todo list");
    expect(help).toContain("/todo between");
    expect(help).toContain("/todo settings");
    expect(help).toContain("/todo help");
  });
});
