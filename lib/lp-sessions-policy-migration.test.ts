/** @jest-environment node */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Row-level security on lp_onboarding_sessions has been redefined by more than
// one migration; the later ones win. This reads every migration in order and
// works out which policies are left, so a later "for all" policy for members
// (which would hand back SELECT, and with it the email and link token) fails
// here instead of in production. SOC 2 gap G-6.
const dir = path.join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = files.map((f) => ({ f, text: readFileSync(path.join(dir, f), "utf8") }));

type Policy = { name: string; command: string; body: string; file: string };

function finalPolicies(table: string): Policy[] {
  const live = new Map<string, Policy>();
  const create = new RegExp(`create policy (\\w+) on public\\.${table}\\s+for (\\w+)([\\s\\S]*?);`, "gi");
  const drop = new RegExp(`drop policy if exists (\\w+) on public\\.${table}`, "gi");
  for (const { f, text } of sql) {
    // Within a file, statements run in order.
    const events: { at: number; kind: "drop" | "create"; m: RegExpExecArray }[] = [];
    for (const m of text.matchAll(drop)) events.push({ at: m.index!, kind: "drop", m: m as RegExpExecArray });
    for (const m of text.matchAll(create)) events.push({ at: m.index!, kind: "create", m: m as RegExpExecArray });
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.kind === "drop") live.delete(e.m[1]);
      else live.set(e.m[1], { name: e.m[1], command: e.m[2].toLowerCase(), body: e.m[3], file: f });
    }
  }
  return [...live.values()];
}

describe("row-level security on lp_onboarding_sessions, after every migration", () => {
  const policies = finalPolicies("lp_onboarding_sessions");

  it("has a policy for each command and none for all", () => {
    expect(policies.map((p) => p.command).sort()).toEqual(["delete", "insert", "select", "update"]);
  });

  it("lets only owners and admins in, on every command", () => {
    for (const p of policies) {
      expect(p.body).toMatch(/is_org_admin\(organization_id\)/);
      expect(p.body).not.toMatch(/is_org_writer|current_principal_org_ids/);
    }
  });

  it("comes from the G-6 migration", () => {
    expect(policies.every((p) => p.file === "20261101070000_lp_sessions_admin_only.sql")).toBe(true);
  });
});

describe("the overview a non-admin member reads", () => {
  const text = sql.find((s) => s.f === "20261101070000_lp_sessions_admin_only.sql")!.text;
  const view = text.slice(text.search(/create or replace view public\.lp_onboarding_session_overview/i)).split(/;/)[0];

  it("has no email and no token", () => {
    expect(view).not.toMatch(/\bemail\b|lp_email|\btoken\b/i);
  });

  it("only shows the signed-in user's own organizations", () => {
    expect(view).toMatch(/organization_id in \(select public\.current_principal_org_ids\(\)\)/);
  });

  it("is not readable by anyone signed out", () => {
    expect(text).toMatch(/revoke all on public\.lp_onboarding_session_overview from anon/i);
    expect(text).toMatch(/grant select on public\.lp_onboarding_session_overview to authenticated/i);
    expect(text).not.toMatch(/to anon/i);
  });
});
