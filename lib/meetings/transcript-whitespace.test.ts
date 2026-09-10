/**
 * The transcript trim set, held to JavaScript's.
 *
 * Two pieces of code decide whether a meeting has a transcript, in two
 * languages, and they have to give the same answer:
 *
 *   - Postgres, in the `has_transcript` generated column (migration
 *     20260910180000), which decides whether the log OFFERS to regenerate; and
 *   - JavaScript, in app/api/meetings/[id]/report/regenerate, whose
 *     `.trim()` decides whether that request SUCCEEDS or answers 409.
 *
 * When they disagree the failure is a control that breaks on use: the button
 * appears, and pressing it returns "no transcript on file". That has already
 * happened twice on this column — first with bare `btrim(text)`, which strips
 * spaces only and let "\n\n\n" read as a transcript, then with a six-character
 * ASCII set that let U+00A0 do the same.
 *
 * So this test reads the trim set out of the migration and holds it against
 * what JavaScript actually does, character by character. No database needed:
 * the point is the two definitions agreeing, and that is checkable from the
 * text of one and the behaviour of the other.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260910180000_live_meeting_report_has_transcript.sql",
);

/** Every codepoint the migration passes to btrim as its trim set. */
function trimSetFromMigration(): Set<number> {
  const sql = readFileSync(MIGRATION, "utf8");
  const call = sql.slice(sql.indexOf("btrim("), sql.indexOf(")) > 0"));
  const chars = new Set<number>();
  // The set is written as concatenated E'...' literals, so read the escapes
  // out of each one. \uXXXX plus the ASCII shorthands, plus literal characters.
  for (const [, body] of call.matchAll(/E'((?:[^'\\]|\\.)*)'/g)) {
    for (let i = 0; i < body.length; i++) {
      if (body[i] !== "\\") { chars.add(body.codePointAt(i)!); continue; }
      const next = body[i + 1];
      if (next === "u") { chars.add(parseInt(body.slice(i + 2, i + 6), 16)); i += 5; continue; }
      const ascii: Record<string, number> = { t: 0x09, n: 0x0a, v: 0x0b, f: 0x0c, r: 0x0d };
      expect(ascii[next]).toBeDefined();
      chars.add(ascii[next]);
      i += 1;
    }
  }
  return chars;
}

/** Every BMP codepoint JavaScript's String.prototype.trim removes. */
function javascriptWhitespace(): Set<number> {
  const chars = new Set<number>();
  for (let c = 0; c <= 0xffff; c++) {
    if (String.fromCharCode(c).trim() === "") chars.add(c);
  }
  return chars;
}

const hex = (c: number) => `U+${c.toString(16).toUpperCase().padStart(4, "0")}`;

describe("the has_transcript trim set", () => {
  it("removes nothing JavaScript keeps", () => {
    const extra = [...trimSetFromMigration()].filter((c) => !javascriptWhitespace().has(c));
    // Over-trimming fails closed — a real transcript reads as absent and the
    // button goes missing — but it is still wrong.
    expect(extra.map(hex)).toEqual([]);
  });

  it("removes everything JavaScript removes", () => {
    const missing = [...javascriptWhitespace()].filter((c) => !trimSetFromMigration().has(c));
    // Under-trimming is the dangerous direction: the column says a transcript
    // is there, the log offers the button, and the route answers 409.
    expect(missing.map(hex)).toEqual([]);
  });

  it("covers the two characters that got this wrong before", () => {
    const set = trimSetFromMigration();
    expect(set.has(0x0a)).toBe(true);   // LF — bare btrim(text) missed it
    expect(set.has(0x00a0)).toBe(true); // NBSP — the ASCII-only set missed it
  });

  it("does not claim zero-width space, which JavaScript does not trim", () => {
    // A guard against "whitespace-looking" creeping in: U+200B is not
    // whitespace to JavaScript, so a transcript of it is a transcript.
    expect(String.fromCharCode(0x200b).trim()).not.toBe("");
    expect(trimSetFromMigration().has(0x200b)).toBe(false);
  });
});
