export type ParsedTaskGroup = {
  text: string;
  children: string[];
};

function normalizeTaskTextLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripTrailingColon(text: string): string {
  return text.replace(/[:\s]+$/, "").trim();
}

export function splitFirstToken(text: string): { first: string | null; rest: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { first: null, rest: "" };
  }

  const match = trimmed.match(/^(\S+)\s*(.*)$/);
  if (!match) {
    return { first: null, rest: "" };
  }

  return {
    first: match[1] ?? null,
    rest: (match[2] ?? "").trim(),
  };
}

export function parseTaskGroupsFromText(input: string): ParsedTaskGroup[] {
  const lines = input
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\t/g, "  "));

  const topLevelMarker = /^(?:\d+[.)]|[-*•])\s+(.+)$/;
  const nestedMarker = /^(?:[a-z][.)]|[-*•])\s+(.+)$/i;

  const groups: ParsedTaskGroup[] = [];
  let currentGroup: ParsedTaskGroup | null = null;
  let currentChildIndex = -1;
  let sawExplicitListMarker = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    const leadingSpaces = (rawLine.match(/^ */)?.[0] ?? "").length;
    const isIndented = leadingSpaces >= 2;
    const isAlphaNestedMarker = /^[a-z][.)]\s+/i.test(trimmed);
    const shouldTreatAsNested: boolean =
      Boolean(currentGroup) && (isIndented || isAlphaNestedMarker);

    const topMatch: RegExpMatchArray | null = shouldTreatAsNested
      ? null
      : trimmed.match(topLevelMarker);
    if (topMatch) {
      sawExplicitListMarker = true;
      currentGroup = {
        text: normalizeTaskTextLine(topMatch[1]),
        children: [],
      };
      groups.push(currentGroup);
      currentChildIndex = -1;
      continue;
    }

    const nestedMatch = trimmed.match(nestedMarker);
    if (nestedMatch && currentGroup && shouldTreatAsNested) {
      sawExplicitListMarker = true;
      currentGroup.children.push(normalizeTaskTextLine(nestedMatch[1]));
      currentChildIndex = currentGroup.children.length - 1;
      continue;
    }

    if (currentGroup) {
      if (currentChildIndex >= 0) {
        const previous = currentGroup.children[currentChildIndex];
        currentGroup.children[currentChildIndex] = normalizeTaskTextLine(`${previous} ${trimmed}`);
      } else {
        currentGroup.text = normalizeTaskTextLine(`${currentGroup.text} ${trimmed}`);
      }
      continue;
    }

    // If message starts as free text before markers, preserve it as a top-level task candidate.
    currentGroup = {
      text: normalizeTaskTextLine(trimmed),
      children: [],
    };
    groups.push(currentGroup);
    currentChildIndex = -1;
  }

  if (!groups.length) {
    return [];
  }

  // If no list markers were seen, treat the whole input as one task.
  if (!sawExplicitListMarker) {
    return [
      {
        text: normalizeTaskTextLine(input),
        children: [],
      },
    ];
  }

  return groups
    .map((group) => ({
      text: stripTrailingColon(normalizeTaskTextLine(group.text)),
      children: group.children
        .map((child) => normalizeTaskTextLine(child))
        .filter((child) => Boolean(child)),
    }))
    .filter((group) => Boolean(group.text));
}
