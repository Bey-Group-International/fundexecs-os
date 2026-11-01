import {
  RECOVERY_CODE_COUNT,
  RECOVERY_LOCK_WINDOW_MS,
  RECOVERY_MAX_FAILURES,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  recoveryLocked,
} from "@/lib/mfa-recovery";

describe("recovery codes", () => {
  it("generates ten distinct codes in xxxxx-xxxxx form, without look-alike characters", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const c of codes) expect(c).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
  });

  it("normalizes case, spaces and the dash, and rejects anything that is not a code", () => {
    expect(normalizeRecoveryCode("abcde-fghjk")).toBe("ABCDEFGHJK");
    expect(normalizeRecoveryCode(" ABCDE FGHJK ")).toBe("ABCDEFGHJK");
    for (const bad of ["", "ABCDE", "ABCDE-FGHJ0", "ABCDE-FGHJKM", null, undefined, 12]) {
      expect(normalizeRecoveryCode(bad)).toBeNull();
    }
  });

  it("hashes the same code the same way, and differently under another key", async () => {
    const a = await hashRecoveryCode("ABCDEFGHJK", { MFA_RECOVERY_SECRET: "one" });
    expect(await hashRecoveryCode("ABCDEFGHJK", { MFA_RECOVERY_SECRET: "one" })).toBe(a);
    expect(await hashRecoveryCode("ABCDEFGHJK", { MFA_RECOVERY_SECRET: "two" })).not.toBe(a);
    expect(await hashRecoveryCode("ABCDEFGHJM", { MFA_RECOVERY_SECRET: "one" })).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a generated code survives the show -> type -> normalize -> hash round trip", async () => {
    const env = { MFA_RECOVERY_SECRET: "k" };
    const [c] = generateRecoveryCodes(1);
    expect(await hashRecoveryCode(normalizeRecoveryCode(c.toLowerCase())!, env)).toBe(await hashRecoveryCode(c.replace("-", ""), env));
  });
});

describe("recoveryLocked", () => {
  const now = 1_000_000_000;
  it("locks at the limit, counting only failures inside the window", () => {
    const recent = Array.from({ length: RECOVERY_MAX_FAILURES }, (_, i) => now - i * 1000);
    expect(recoveryLocked(recent, now)).toBe(true);
    expect(recoveryLocked(recent.slice(1), now)).toBe(false);
    const stale = recent.map((t) => t - RECOVERY_LOCK_WINDOW_MS);
    expect(recoveryLocked(stale, now)).toBe(false);
  });
});
