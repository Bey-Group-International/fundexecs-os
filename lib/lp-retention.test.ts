import { readFileSync } from "fs";
import { ABANDONED_AFTER_DAYS, confirmsName, eraseMessage, isEraseOutcome } from "@/lib/lp-retention";

describe("confirmsName", () => {
  it("accepts the exact name regardless of case and spacing", () => {
    expect(confirmsName("  ada   LOVELACE ", "Ada Lovelace")).toBe(true);
  });
  it("rejects anything else, including a blank name", () => {
    expect(confirmsName("Ada", "Ada Lovelace")).toBe(false);
    expect(confirmsName("", "")).toBe(false);
    expect(confirmsName(null, "Ada Lovelace")).toBe(false);
  });
});

describe("eraseMessage", () => {
  it("explains what was and was not removed", () => {
    const m = eraseMessage("erased");
    expect(m.ok).toBe(true);
    expect(m.text).toMatch(/Stripe/);
  });
  it("tells the manager why a retained LP was kept", () => {
    expect(eraseMessage("retention_required")).toMatchObject({ ok: false });
    expect(eraseMessage("not_found").ok).toBe(false);
  });
  it("only accepts the three outcomes the database returns", () => {
    expect(isEraseOutcome("erased")).toBe(true);
    expect(isEraseOutcome("whatever")).toBe(false);
  });
});

describe("the migration", () => {
  const sql = readFileSync("supabase/migrations/20261101150000_lp_erasure_and_retention.sql", "utf8");
  it("is not callable by signed-in users or anon", () => {
    expect(sql).toMatch(/revoke all on function public\.erase_lp_onboarding.*from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on function public\.purge_abandoned_lp_onboarding.*from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.erase_lp_onboarding.*to service_role/);
  });
  it("refuses approved, committed, complete and flagged LPs", () => {
    expect(sql).toContain("v_review = 'approved'");
    expect(sql).toContain("('committed', 'complete')");
    expect(sql).toContain("status = 'flagged'");
  });
  it("writes the audit entry before it deletes, and keeps the audit log", () => {
    expect(sql.indexOf("'lp.erased'")).toBeLessThan(sql.indexOf("delete from public.lp_onboarding_sessions where id = p_session"));
    expect(sql).not.toMatch(/delete from public\.onboarding_audit_log/);
  });
  it("enforces the retention floor the app promises", () => {
    expect(sql).toContain("p_days < 30");
    expect(ABANDONED_AFTER_DAYS).toBeGreaterThanOrEqual(30);
  });
});
