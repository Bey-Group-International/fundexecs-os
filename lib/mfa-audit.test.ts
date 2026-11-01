import { MFA_AUDIT_ACTIONS, mfaAuditRow } from "@/lib/mfa-audit";

describe("mfaAuditRow", () => {
  it("builds a row with only allow-listed, scalar detail", () => {
    const row = mfaAuditRow({
      userId: "u1",
      organizationId: "o1",
      action: "mfa.recovery_used",
      detail: { factors_removed: 1, secret: "LEAK", reason: "x".repeat(200) } as never,
    });
    expect(row).toEqual({ user_id: "u1", organization_id: "o1", action: "mfa.recovery_used", detail: { factors_removed: 1, reason: "x".repeat(64) } });
    expect(JSON.stringify(row)).not.toContain("LEAK");
  });
  it("refuses an unknown action or a missing user", () => {
    expect(mfaAuditRow({ userId: "u1", action: "mfa.nope" as never })).toBeNull();
    expect(mfaAuditRow({ userId: "", action: "mfa.enrolled" })).toBeNull();
  });
  it("covers exactly the actions the migration allows", () => {
    const sql = require("fs").readFileSync("supabase/migrations/20261101140000_security_audit_and_mfa_recovery.sql", "utf8");
    for (const a of MFA_AUDIT_ACTIONS) expect(sql).toContain(`'${a}'`);
  });
});
