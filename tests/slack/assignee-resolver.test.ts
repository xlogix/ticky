import { describe, expect, it, vi } from "vitest";

async function loadModule() {
  vi.resetModules();
  return import("../../src/slack/assignee-resolver");
}

describe("assignee resolver", () => {
  it("extracts valid mentioned users and ignores placeholders", async () => {
    const { extractMentionedUsers } = await loadModule();

    expect(extractMentionedUsers("<@u12345678|john> and <@W99999999> and <@user>")).toEqual([
      "U12345678",
      "W99999999",
    ]);
  });

  it("resolves explicit Slack mention and title", async () => {
    const { resolveAssigneeAndTitleFromText } = await loadModule();
    const list = vi.fn();
    const client = { users: { list } } as any;

    const result = await resolveAssigneeAndTitleFromText("<@U12345678|john> finish report", client);

    expect(result).toEqual({ ok: true, assignee: "U12345678", title: "finish report" });
    expect(list).not.toHaveBeenCalled();
  });

  it("resolves plain @name using workspace directory", async () => {
    const { resolveAssigneeAndTitleFromText } = await loadModule();
    const list = vi.fn(async () => ({
      members: [
        {
          id: "U100",
          name: "john",
          profile: { display_name: "John Doe" },
        },
      ],
      response_metadata: {},
    }));
    const client = { users: { list } } as any;

    const result = await resolveAssigneeAndTitleFromText("@John Doe send update", client);

    expect(result).toEqual({ ok: true, assignee: "U100", title: "send update" });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("keeps assignee null for non-mention task text", async () => {
    const { resolveAssigneeAndTitleFromText } = await loadModule();
    const list = vi.fn(async () => ({ members: [], response_metadata: {} }));
    const client = { users: { list } } as any;

    const result = await resolveAssigneeAndTitleFromText("finish quarterly report", client);

    expect(result).toEqual({ ok: true, assignee: null, title: "finish quarterly report" });
    expect(list).not.toHaveBeenCalled();
  });

  it("resolves malformed bracket mention via directory lookup", async () => {
    const { resolveAssigneeAndTitleFromText } = await loadModule();
    const list = vi.fn(async () => ({
      members: [
        {
          id: "U200",
          profile: { display_name_normalized: "Aman Kumar Nirala" },
        },
      ],
      response_metadata: {},
    }));
    const client = { users: { list } } as any;

    const result = await resolveAssigneeAndTitleFromText(
      "<@Aman Kumar Nirala> demo complete",
      client,
    );

    expect(result).toEqual({ ok: true, assignee: "U200", title: "demo complete" });
  });

  it("returns unresolved message for bad assignee token", async () => {
    const { resolveAssigneeAndTitleFromText } = await loadModule();
    const list = vi.fn(async () => ({ members: [], response_metadata: {} }));
    const client = { users: { list } } as any;

    const result = await resolveAssigneeAndTitleFromText("<@user> finish report", client);

    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain("Couldn't resolve assignee");
  });

  it("returns unresolved when @name is ambiguous in directory", async () => {
    const { resolveAssigneeAndTitleFromText } = await loadModule();
    const list = vi.fn(async () => ({
      members: [
        { id: "U1AAAAAAA", name: "john" },
        { id: "U2BBBBBBB", profile: { display_name: "john" } },
      ],
      response_metadata: {},
    }));
    const client = { users: { list } } as any;

    const result = await resolveAssigneeAndTitleFromText("@john finish report", client);

    expect(result.ok).toBe(false);
  });

  it("returns missing-scope guidance when users:read is missing", async () => {
    const { resolveAssigneeAndTitleFromText } = await loadModule();
    const list = vi.fn(async () => {
      throw { data: { error: "missing_scope" } };
    });
    const client = { users: { list } } as any;

    const result = await resolveAssigneeAndTitleFromText("@john finish report", client);

    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain("users:read");
  });

  it("caches workspace users between calls", async () => {
    const { resolveAssigneeAndTitleFromText } = await loadModule();
    const list = vi.fn(async () => ({
      members: [
        {
          id: "U500",
          name: "john",
        },
      ],
      response_metadata: {},
    }));
    const client = { users: { list } } as any;

    const first = await resolveAssigneeAndTitleFromText("@john first", client);
    const second = await resolveAssigneeAndTitleFromText("@john second", client);

    expect(first).toEqual({ ok: true, assignee: "U500", title: "first" });
    expect(second).toEqual({ ok: true, assignee: "U500", title: "second" });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("requires non-empty task title", async () => {
    const { resolveAssigneeAndTitleFromText } = await loadModule();
    const client = { users: { list: vi.fn() } } as any;

    const result = await resolveAssigneeAndTitleFromText("   ", client);
    expect(result).toEqual({ ok: false, message: "Task title is required." });
  });
});
