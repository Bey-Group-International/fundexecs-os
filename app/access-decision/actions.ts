"use server";

import { redirect } from "next/navigation";
import { applyAccessDecisionByToken } from "@/lib/access-requests";

// The write behind the emailed Approve / Decline buttons.
//
// Authority is the token, so this is the only place it is spent. The token is
// re-resolved inside applyAccessDecisionByToken rather than trusted from the
// form, and it is cleared by the same UPDATE that records the decision — so a
// second submit of a stale page changes nothing.
export async function confirmAccessDecision(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const decision = String(formData.get("decision") ?? "") === "approve"
    ? ("approved" as const)
    : ("declined" as const);

  const result = await applyAccessDecisionByToken({ token, decision });

  if (!result.ok) {
    redirect(`/access-decision?error=${encodeURIComponent(result.error)}`);
  }

  redirect(`/access-decision?done=${decision}`);
}
