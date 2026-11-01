// lib/lp-reuse.ts
// When a returning LP is sent a new link, what from their last onboarding MAY be
// reused so they don't repeat it. Pure, so the rules are tested on their own.
//
// NOTHING IS REUSED UNTIL A PERSON CONFIRMS IT (SOC 2 gap G-9). The email address
// is only a hint that this might be the same person: it can change hands, or be
// mistyped into someone else's. So these rules produce a PROPOSAL, shown to the
// fund manager beside the earlier onboarding's name; only their confirmation
// writes the check (lib/lp-reuse.server.ts).
//
// WHAT CARRIES OVER: the government-ID check only. It records who a person IS,
// which doesn't change between onboardings.
//
// WHAT DOES NOT, ON PURPOSE: sanctions, PEP, adverse-media and litigation results
// go stale as the lists change, and a carried-over "clear" would also stop the
// automatic OFAC screen from flagging a new hit on top of it. Accreditation
// depends on what the LP states this time. All of those run again every time.
// Widening this is one line (REUSABLE_CHECK_KINDS), but think through the OFAC
// overwrite rule in lib/ofac.server.ts first.
//
// WHEN: the earlier onboarding must have been APPROVED by a person, the check
// must still be clear and unexpired, and no more than a year old whatever expiry
// the fund manager gave it. If that email has ever been rejected in the
// organization, nothing carries over.
import type { OnboardingCheckKind } from "@/lib/supabase/database.types";

export const REUSABLE_CHECK_KINDS: OnboardingCheckKind[] = ["identity"];
export const REUSE_WINDOW_DAYS = 365;

const DAY_MS = 86_400_000;
const SUMMARY_MAX = 500;

export interface PriorSession {
  id: string;
  review_state: string;
  /** The name on that onboarding, so a person can compare it with the new one. */
  lp_name?: string | null;
}

export interface PriorCheck {
  session_id: string;
  kind: OnboardingCheckKind;
  status: string;
  method: string;
  vendor_ref: string | null;
  summary: string | null;
  checked_at: string | null;
  expires_at: string | null;
}

export interface CarriedCheck {
  kind: OnboardingCheckKind;
  status: "clear";
  method: string;
  vendor_ref: string | null;
  summary: string;
  /** When the check was originally cleared. The date is kept, not reset. */
  checked_at: string;
  /** The earlier of the original expiry and a year after it was cleared. */
  expires_at: string;
  fromSessionId: string;
  /** The name on the onboarding it came from, if known. */
  fromName: string | null;
}

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/** The prior clearances worth carrying over for one email address in one organization. */
export function reusableChecks(sessions: PriorSession[], checks: PriorCheck[], now: number): CarriedCheck[] {
  // Someone turned down before is never carried forward.
  if (sessions.some((s) => s.review_state === "rejected")) return [];
  const approved = new Set(sessions.filter((s) => s.review_state === "approved").map((s) => s.id));
  if (approved.size === 0) return [];

  const out: CarriedCheck[] = [];
  for (const kind of REUSABLE_CHECK_KINDS) {
    let best: CarriedCheck | null = null;
    for (const c of checks) {
      if (c.kind !== kind || c.status !== "clear" || !c.checked_at || !approved.has(c.session_id)) continue;
      const checkedAt = new Date(c.checked_at).getTime();
      if (Number.isNaN(checkedAt)) continue;
      const windowEnd = checkedAt + REUSE_WINDOW_DAYS * DAY_MS;
      const ownExpiry = c.expires_at ? new Date(c.expires_at).getTime() : Infinity;
      const expiry = Math.min(windowEnd, ownExpiry);
      if (!(expiry > now)) continue;
      if (best && new Date(best.checked_at).getTime() >= checkedAt) continue;
      const prior = (c.summary ?? "").trim();
      const note = `Carried forward from the ${day(c.checked_at)} onboarding${prior ? `: ${prior}` : "."}`;
      best = {
        kind,
        status: "clear",
        method: c.method,
        vendor_ref: c.vendor_ref,
        summary: note.length > SUMMARY_MAX ? `${note.slice(0, SUMMARY_MAX - 1)}…` : note,
        checked_at: c.checked_at,
        expires_at: new Date(expiry).toISOString(),
        fromSessionId: c.session_id,
        fromName: sessions.find((x) => x.id === c.session_id)?.lp_name ?? null,
      };
    }
    if (best) out.push(best);
  }
  return out;
}

/** An email as stored and as compared: trimmed and lower-cased. */
export const normalizeEmail = (email: unknown): string => (typeof email === "string" ? email.trim().toLowerCase() : "");

/** Escapes % _ and \ so an email can't act as a pattern in a LIKE comparison. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** A name as compared: trimmed, lower-cased, accents and punctuation dropped, spaces collapsed. */
export function normalizeName(name: unknown): string {
  if (typeof name !== "string") return "";
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Dots and apostrophes vanish ("L.P." is "LP", "O'Brien" is "OBrien"); other punctuation separates words.
    .replace(/[.'\u2019]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether two onboardings name the same party, ignoring case, accents, punctuation
 * and word order. It only SETS EXPECTATIONS for the person confirming ("names
 * differ") and never decides anything; a nickname or a re-registered entity will
 * read as different, and that is the right side to err on.
 */
export function namesMatch(a: unknown, b: unknown): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return [...x.split(" ")].sort().join(" ") === [...y.split(" ")].sort().join(" ");
}

export type CarryoverStatus = "proposed" | "confirmed" | "declined";

/** Whether a proposal can still be confirmed: it is open, and the check has not lapsed since. */
export function canConfirmCarryover(p: { status: string; expires_at: string }, now: number): boolean {
  return p.status === "proposed" && new Date(p.expires_at).getTime() > now;
}
