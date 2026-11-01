/** @jest-environment node */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { INBOX_CHANNELS } from "./channels";

// The Inbox source is a database enum. A channel the app knows about but no
// migration declares fails at insert time, in production, quietly (the notice
// code logs and carries on). This fails in CI instead.
describe("every Inbox channel is declared by a migration", () => {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(path.join(dir, f), "utf8"))
    .join("\n");

  it.each(Object.keys(INBOX_CHANNELS))("%s", (channel) => {
    const created = new RegExp(`create type inbox_channel as enum \\([^)]*'${channel}'`, "i").test(sql);
    const added = new RegExp(`alter type (public\\.)?inbox_channel add value( if not exists)? '${channel}'`, "i").test(sql);
    expect(created || added).toBe(true);
  });
});
