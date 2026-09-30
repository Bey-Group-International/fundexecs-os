/**
 * The two things the drafts table must enforce itself, read from the migration.
 *
 * A source-text test, and weaker than a behavioural one for exactly the reason the
 * finding it guards existed: the previous version of this migration ASSERTED the
 * cross-organisation invariant in a comment and enforced nothing, and no test
 * noticed because none of them ran SQL. This cannot run SQL either. What it can do
 * is fail if the clause that enforces it disappears.
 *
 * Matched on the clause and its target, not on a word, so prose about the
 * constraint cannot satisfy it.
 */
import { readFileSync } from "fs";
import { join } from "path";

const SQL = readFileSync(
  join(__dirname, "..", "..", "supabase", "migrations", "20260930190000_inbox_thread_drafts.sql"),
  "utf8",
);

/** Whitespace-insensitive, so reformatting the migration does not fail this. */
const flat = SQL.replace(/\s+/g, " ");

describe("a draft cannot be attached to another organisation's thread", () => {
  /**
   * The bug this closes: thread_id is the PRIMARY KEY, so its uniqueness is GLOBAL
   * across organisations. A writer in organisation A who knew a thread UUID from
   * organisation B could insert {thread_id: B's thread, organization_id: A} — RLS
   * checked only that they may write for A. The row then occupied B's one draft
   * slot for that thread and was invisible under B's own select policy, so B could
   * never clear it. CWE-639, and a denial of service on somebody else's thread.
   */
  it("references the thread by BOTH id and organisation", () => {
    expect(flat).toMatch(
      /foreign key \(thread_id, organization_id\) references public\.inbox_threads \(id, organization_id\)/i,
    );
  });

  // The composite reference needs a unique key to point at; id alone being the
  // primary key is not enough for Postgres to accept the target.
  it("creates the unique key that reference needs", () => {
    expect(flat).toMatch(
      /create unique index if not exists \w+ on public\.inbox_threads \(id, organization_id\)/i,
    );
  });

  /**
   * Kept alongside the foreign key rather than instead of it. The constraint makes
   * the row unrepresentable; the policy refuses the write with an error naming the
   * organisation rather than an index. Belt and braces on a path that runs a
   * handful of times per meeting.
   */
  it("also refuses it at the policy layer", () => {
    const write = flat.match(/create policy inbox_thread_drafts_write.*?;/i)?.[0] ?? "";
    expect(write).toMatch(/with check \(/i);
    expect(write).toMatch(/exists \( select 1 from public\.inbox_threads t/i);
    expect(write).toMatch(/t\.organization_id = inbox_thread_drafts\.organization_id/i);
  });

  // The thread is still the key, which is what makes one draft per thread a fact
  // rather than a convention.
  it("keeps one draft per thread", () => {
    expect(flat).toMatch(/thread_id uuid primary key/i);
  });
});
