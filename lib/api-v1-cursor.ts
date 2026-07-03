// Keyset pagination cursor for the public /api/v1 list routes (deals,
// investors, funds). Generalizes the pattern lib/task-cursor.ts established
// for the internal /api/task route to any total-ordered sort column —
// timestamp, free text, or a nullable numeric with nulls-last ordering — so
// the public API can page through arbitrarily large collections instead of
// returning every row for the org in one response.
//
// The cursor carries the sort column's value at the last row of the previous
// page (`v`, or null when that row's sort column was itself null) plus its
// `id` as a tiebreaker, so ordering is total even when many rows share the
// same sort value. It's JSON, not a hand-built delimited string — a nullable,
// arbitrary-text sort value has no substring that's safe to use as a
// separator, and JSON sidesteps that entirely rather than requiring an
// escaping scheme of its own.
export interface Cursor {
  v: string | null;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { v, id } = parsed as { v?: unknown; id?: unknown };
    if (typeof id !== "string" || !id) return null;
    if (typeof v !== "string" && v !== null) return null;
    return { v, id };
  } catch {
    return null;
  }
}

// PostgREST's filter-value grammar treats `,` `.` `:` `(` `)` as structural
// characters, so a free-text value (e.g. an investor name) can't always be
// interpolated into a `.or()` filter string unquoted. Wrapping every cursor
// value in double quotes (escaping embedded backslashes/quotes) is safe for
// any column type — PostgREST casts a quoted literal the same as an
// unquoted one — so this is applied uniformly rather than branching on the
// column's type.
export function pgLiteral(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Clamp a `?limit=` query param to [1, max], defaulting to `def` when absent or invalid. */
export function clampLimit(raw: string | null, def = 50, max = 200): number {
  const n = parseInt(raw ?? "", 10);
  return Math.min(Math.max(1, Number.isNaN(n) ? def : n), max);
}
