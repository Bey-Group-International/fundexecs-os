/** @jest-environment node */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// The audit trigger function has been redefined by more than one migration; the
// last definition is the one that runs. This reads that one and fails if any
// entry it writes forgets to say who it is about, which is how a null actor
// goes back to meaning "unknown" without anyone deciding it should.
describe("the audit trigger function's latest definition", () => {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const defining = files.filter((f) => /create or replace function public\.onboarding_audit\(\)/i.test(readFileSync(path.join(dir, f), "utf8")));
  const latest = readFileSync(path.join(dir, defining[defining.length - 1]), "utf8");
  const fn = latest.slice(latest.search(/create or replace function public\.onboarding_audit\(\)/i));
  const inserts = fn.split(/insert into public\.onboarding_audit_log/i).slice(1).map((chunk) => chunk.split(/values/i)[0]);

  it("is defined by a migration", () => {
    expect(defining.length).toBeGreaterThanOrEqual(2);
  });

  it("names actor_kind in every entry it writes", () => {
    expect(inserts.length).toBeGreaterThanOrEqual(5);
    for (const columns of inserts) expect(columns).toMatch(/\bactor_kind\b/);
  });

  it("restricts actor_kind to the three kinds the app uses", () => {
    const all = files.map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");
    expect(all).toMatch(/actor_kind is null or actor_kind in \('user', 'lp', 'system'\)/);
  });

  it("is the same set of kinds the app is allowed to write", () => {
    // lib/lp-audit.ts ActorKind
    const src = readFileSync(path.join(process.cwd(), "lib", "lp-audit.ts"), "utf8");
    expect(src).toMatch(/type ActorKind = "user" \| "lp" \| "system"/);
  });
});
