import { describe, expect, it } from "vitest";
import { escapeMrkdwn, isChannelNotFoundError } from "../../src/slack/message-helpers";

describe("message helpers", () => {
  it("escapes slack mrkdwn special characters", () => {
    expect(escapeMrkdwn("a&b<c>d")).toBe("a&amp;b&lt;c&gt;d");
  });

  it("detects channel_not_found platform error", () => {
    expect(isChannelNotFoundError({ data: { error: "channel_not_found" } })).toBe(true);
    expect(isChannelNotFoundError({ data: { error: "missing_scope" } })).toBe(false);
    expect(isChannelNotFoundError(new Error("boom"))).toBe(false);
  });
});
