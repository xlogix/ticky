export function parseToggleButtonValue(
  raw: string | undefined,
): { taskId: string; done: boolean } | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { taskId?: string; done?: boolean };
    if (!parsed.taskId || typeof parsed.done !== "boolean") {
      return null;
    }
    return {
      taskId: parsed.taskId,
      done: parsed.done,
    };
  } catch {
    return null;
  }
}

export function normalizeTaskId(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const quoted = trimmed.match(/^"(.+)"$/);
  return quoted ? quoted[1] : trimmed;
}

export function extractTaskIdFromBlocks(blocks: any[] | undefined): string | null {
  if (!Array.isArray(blocks)) {
    return null;
  }

  for (const block of blocks) {
    const blockId = typeof block?.block_id === "string" ? block.block_id : "";
    const fromBlockId = blockId.match(/^task_(?:card|section|actions|card_actions):(.+)$/);
    if (fromBlockId?.[1]) {
      return normalizeTaskId(fromBlockId[1]);
    }

    if (blockId.startsWith("task_card_context:")) {
      const candidate = blockId.replace("task_card_context:", "");
      return normalizeTaskId(candidate);
    }
  }

  for (const block of blocks) {
    const elements = Array.isArray(block?.elements) ? block.elements : [];
    for (const element of elements) {
      const text = typeof element?.text === "string" ? element.text : "";
      const match = text.match(/Task ID:\s*([A-Za-z0-9_]+)/);
      if (match?.[1]) {
        return normalizeTaskId(match[1]);
      }
    }
  }

  return null;
}
