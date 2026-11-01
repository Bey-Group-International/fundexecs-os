// Server-side MFA enforcement for pages. API handlers get the same decision
// from requireOrgContext (lib/auth.ts); this is the redirecting counterpart.
import { redirect } from "next/navigation";
import type { SessionContext } from "@/lib/auth";
import { MFA_CHALLENGE_PATH, MFA_ENROLL_PATH, mfaGate } from "@/lib/mfa";

/** Send the person to enroll or to answer the challenge when the gate is not open. */
export function enforceMfa(ctx: Pick<SessionContext, "mfa">): void {
  if (!ctx.mfa) return;
  const gate = mfaGate(ctx.mfa);
  if (gate === "enroll") redirect(MFA_ENROLL_PATH);
  if (gate === "challenge") redirect(MFA_CHALLENGE_PATH);
}
