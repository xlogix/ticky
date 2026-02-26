export type SlackDirectoryUser = {
  id?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  name?: string;
  profile?: {
    display_name?: string;
    display_name_normalized?: string;
    real_name?: string;
    real_name_normalized?: string;
  };
};

type SlackUsersListResponse = {
  members?: SlackDirectoryUser[];
  response_metadata?: {
    next_cursor?: string;
  };
};

export type SlackUsersClient = {
  users: {
    list: (args: { limit?: number; cursor?: string }) => Promise<SlackUsersListResponse>;
  };
};

type AssigneeTextResolution =
  | {
      kind: "resolved";
      assignee: string;
      title: string;
    }
  | {
      kind: "none";
    }
  | {
      kind: "unresolved";
    }
  | {
      kind: "missing_scope";
    };

export type AssigneeAndTitleResolution =
  | {
      ok: true;
      assignee: string | null;
      title: string;
    }
  | {
      ok: false;
      message: string;
    };

const USER_DIRECTORY_CACHE_TTL_MS = 5 * 60 * 1000;
let userDirectoryCache: { fetchedAt: number; users: SlackDirectoryUser[] } | null = null;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isLikelySlackUserId(value: string): boolean {
  return /^[UW][A-Z0-9]{8,}$/i.test(value.trim());
}

export function extractMentionedUsers(text: string): string[] {
  // Supports both <@U12345> and <@U12345|display_name> formats.
  // Restrict to Slack user IDs so placeholders like <@user> are not treated as real assignees.
  const matches = text.matchAll(/<@([^>|]+)(?:\|[^>]+)?>/gi);
  const users = Array.from(matches, (match) => (match[1] ?? "").toUpperCase()).filter((userId) =>
    isLikelySlackUserId(userId),
  );
  return Array.from(new Set(users));
}

function stripFirstMentionToken(text: string, userId: string): string {
  const escaped = userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`<@${escaped}(?:\\|[^>]+)?>`, "i"), "").trim();
}

function looksLikeUnresolvedAssigneeToken(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  const firstToken = (trimmed.split(/\s+/)[0] ?? "").trim();

  // Placeholder-like token that is not a Slack user ID mention.
  if (
    /^<@[^>]+>$/.test(firstToken) &&
    !isLikelySlackUserId(firstToken.replace(/^<@/, "").replace(/>$/, "").split("|")[0] ?? "")
  ) {
    return true;
  }

  // Handles malformed patterns like "<@Display Name> task" and "<@Display task".
  if (
    trimmed.startsWith("<@") &&
    !isLikelySlackUserId(
      trimmed
        .slice(2)
        .split(">")[0]
        ?.split("|")[0] ?? "",
    )
  ) {
    return true;
  }

  // Plain @handle token.
  if (/^@[A-Za-z0-9._-]+$/.test(firstToken)) {
    return true;
  }

  return false;
}

function userNameCandidates(user: SlackDirectoryUser): string[] {
  const candidates = [
    user.name,
    user.profile?.display_name_normalized,
    user.profile?.display_name,
    user.profile?.real_name_normalized,
    user.profile?.real_name,
  ];

  const names: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const normalized = candidate.trim().replace(/^@+/, "").replace(/\s+/g, " ");
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    names.push(normalized);
  }

  return names;
}

function isAssignableUser(user: SlackDirectoryUser): user is SlackDirectoryUser & { id: string } {
  return Boolean(user.id) && !user.deleted && !user.is_bot && !user.is_app_user;
}

function extractMalformedBracketAssignee(text: string): { name: string; title: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("<@")) {
    return null;
  }

  const closeIndex = trimmed.indexOf(">");
  if (closeIndex < 0) {
    return null;
  }

  const rawMention = trimmed.slice(2, closeIndex).trim();
  if (!rawMention) {
    return null;
  }

  const idPart = rawMention.split("|")[0]?.trim() ?? "";
  if (isLikelySlackUserId(idPart)) {
    return null;
  }

  const namePart = (rawMention.split("|").pop() ?? rawMention).trim().replace(/^@+/, "");
  const title = trimmed.slice(closeIndex + 1).trim();
  if (!namePart || !title) {
    return null;
  }

  return {
    name: namePart,
    title,
  };
}

function selectUniqueAssignee(
  users: SlackDirectoryUser[],
  predicate: (candidateName: string, user: SlackDirectoryUser) => boolean,
): string | null {
  const matches = users
    .filter(isAssignableUser)
    .filter((user) =>
      userNameCandidates(user).some((candidateName) => predicate(candidateName, user)),
    );

  if (matches.length !== 1) {
    return null;
  }

  return matches[0].id;
}

function resolveFromLeadingAtMention(
  text: string,
  users: SlackDirectoryUser[],
): { assignee: string; title: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("@")) {
    return null;
  }

  const mentionText = trimmed.slice(1);
  if (!mentionText.trim()) {
    return null;
  }

  let bestMatch: { assignee: string; title: string; consumed: number } | null = null;
  let ambiguous = false;

  for (const user of users) {
    if (!isAssignableUser(user)) {
      continue;
    }

    for (const candidateName of userNameCandidates(user)) {
      const candidatePattern = candidateName
        .split(/\s+/)
        .map((part) => escapeRegExp(part))
        .join("\\s+");
      const matcher = new RegExp(`^${candidatePattern}(?=\\s|$)`, "i");
      const match = mentionText.match(matcher);
      if (!match) {
        continue;
      }

      const title = mentionText.slice(match[0].length).trim();
      if (!title) {
        continue;
      }

      const consumed = match[0].length;
      if (!bestMatch || consumed > bestMatch.consumed) {
        bestMatch = {
          assignee: user.id,
          title,
          consumed,
        };
        ambiguous = false;
        continue;
      }

      if (consumed === bestMatch.consumed && bestMatch.assignee !== user.id) {
        ambiguous = true;
      }
    }
  }

  if (!bestMatch || ambiguous) {
    return null;
  }

  return {
    assignee: bestMatch.assignee,
    title: bestMatch.title,
  };
}

async function fetchWorkspaceUsers(client: SlackUsersClient): Promise<SlackDirectoryUser[]> {
  const now = Date.now();
  if (userDirectoryCache && now - userDirectoryCache.fetchedAt < USER_DIRECTORY_CACHE_TTL_MS) {
    return userDirectoryCache.users;
  }

  const users: SlackDirectoryUser[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await client.users.list({
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });

    if (Array.isArray(page.members)) {
      users.push(...page.members);
    }

    const nextCursor = page.response_metadata?.next_cursor?.trim();
    if (!nextCursor) {
      break;
    }
    cursor = nextCursor;
  }

  userDirectoryCache = {
    fetchedAt: now,
    users,
  };

  return users;
}

async function resolveAssigneeFromTextMention(
  text: string,
  client: SlackUsersClient,
): Promise<AssigneeTextResolution> {
  const trimmed = text.trim();
  if (!trimmed.startsWith("@") && !trimmed.startsWith("<@")) {
    return { kind: "none" };
  }

  let users: SlackDirectoryUser[];
  try {
    users = await fetchWorkspaceUsers(client);
  } catch (error) {
    const slackError = error as { data?: { error?: string } };
    if (slackError?.data?.error === "missing_scope") {
      return { kind: "missing_scope" };
    }
    throw error;
  }

  const bracketMention = extractMalformedBracketAssignee(trimmed);
  if (bracketMention) {
    const normalizedTarget = bracketMention.name.toLowerCase().replace(/\s+/g, " ");
    const assignee = selectUniqueAssignee(
      users,
      (candidateName) => candidateName.toLowerCase().replace(/\s+/g, " ") === normalizedTarget,
    );

    if (!assignee) {
      return { kind: "unresolved" };
    }

    return {
      kind: "resolved",
      assignee,
      title: bracketMention.title,
    };
  }

  const leadingMention = resolveFromLeadingAtMention(trimmed, users);
  if (!leadingMention) {
    return trimmed.startsWith("@") || trimmed.startsWith("<@")
      ? { kind: "unresolved" }
      : { kind: "none" };
  }

  return {
    kind: "resolved",
    assignee: leadingMention.assignee,
    title: leadingMention.title,
  };
}

export async function resolveAssigneeAndTitleFromText(
  text: string,
  client: SlackUsersClient,
): Promise<AssigneeAndTitleResolution> {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      ok: false,
      message: "Task title is required.",
    };
  }

  const mentions = extractMentionedUsers(trimmed);
  let assignee = mentions[0] ?? null;
  let title = trimmed;

  if (assignee) {
    title = stripFirstMentionToken(title, assignee);
  } else {
    const resolved = await resolveAssigneeFromTextMention(trimmed, client);
    if (resolved.kind === "resolved") {
      assignee = resolved.assignee;
      title = resolved.title;
    } else if (resolved.kind === "missing_scope") {
      return {
        ok: false,
        message:
          "Couldn't resolve assignee from `@name`. Add the `users:read` bot scope in Slack, reinstall the app, and try again.",
      };
    }
  }

  if (!assignee && (looksLikeUnresolvedAssigneeToken(trimmed) || trimmed.startsWith("@"))) {
    return {
      ok: false,
      message:
        "Couldn't resolve assignee. Pick a Slack user from mention autocomplete (example: `/todo add @John finish report`) and ensure Slash Command escaping is enabled.",
    };
  }

  const cleanTitle = title.trim();
  if (!cleanTitle) {
    return {
      ok: false,
      message: "Task title is required.",
    };
  }

  return {
    ok: true,
    assignee,
    title: cleanTitle,
  };
}
