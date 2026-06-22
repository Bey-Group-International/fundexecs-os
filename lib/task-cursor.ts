// Keyset pagination cursor for GET /api/task.
//
// Workflows are ordered by (created_at desc, id desc). created_at alone is not
// unique, so a cursor on it can skip or duplicate rows that share a timestamp;
// the id tiebreaker makes the ordering total and the page boundary exact. The
// cursor is an opaque base64url token encoding both keys.
export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`).toString("base64url");
}

export function decodeCursor(raw: string): { createdAt: string; id: string } | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const sep = decoded.lastIndexOf("|");
    if (sep === -1) return null;
    const createdAt = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
