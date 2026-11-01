// LP data erasure and retention: the words and numbers, pure.
// The rules themselves live in supabase/migrations/20261101150000_lp_erasure_and_retention.sql;
// this is what the app says about their outcome, and the one place the numbers are named.

/** Abandoned links are deleted this long after they expire. The database enforces a floor of 30. */
export const ABANDONED_AFTER_DAYS = 90;

export type EraseOutcome = "erased" | "not_found" | "retention_required";

export function isEraseOutcome(v: unknown): v is EraseOutcome {
  return v === "erased" || v === "not_found" || v === "retention_required";
}

export function eraseMessage(outcome: EraseOutcome): { ok: boolean; text: string } {
  switch (outcome) {
    case "erased":
      return {
        ok: true,
        text:
          "Erased. This LP's details, owners, consents, checks and decisions are gone from FundExecs. " +
          "A record that an erasure happened (no names) is kept in the activity log. " +
          "Anything held by a provider such as Stripe Identity is not removed from here: ask them separately.",
      };
    case "retention_required":
      return {
        ok: false,
        text:
          "This LP can't be erased here: they are approved, have committed capital, or have a flagged screening result. " +
          "Those records may need to be kept by law. Ask your counsel before removing them.",
      };
    default:
      return { ok: false, text: "That LP wasn't found." };
  }
}

/** The fund manager must retype the LP's name before an erasure. Case and spacing do not matter. */
export function confirmsName(typed: unknown, lpName: string): boolean {
  if (typeof typed !== "string") return false;
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(lpName).length > 0 && norm(typed) === norm(lpName);
}
