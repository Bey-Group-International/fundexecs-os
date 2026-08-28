// lib/copilot/identity.ts
//
// Who Earn is talking to. The live chat used to answer every question without
// knowing the operator's name, their firm, or what day it is — so it greeted a
// managing partner like an anonymous visitor and reasoned about "recent" and
// "this quarter" from its training cutoff rather than from today.
//
// This block is injected server-side on EVERY chat turn, unlike the workspace
// snapshot: the operator's own identity is not the org's book, so a fresh dock
// open is not "preloaded" by knowing whose dock it is.
//
// Everything here degrades to null/"" rather than throwing — an unknown name
// must never cost the operator a reply.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface OperatorIdentity {
  operatorName: string | null;
  operatorTitle: string | null;
  firmName: string | null;
}

/**
 * The date as the operator experiences it. The server runs in UTC, so without a
 * zone "today" can be a day off for anyone west of Greenwich in the evening —
 * exactly the operator most likely to ask "what's on my plate today?".
 */
export function formatOperatorDate(now: Date, timeZone?: string | null): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat("en-US", { ...opts, timeZone }).format(now);
    } catch {
      // An unrecognized zone (spoofed or stale client) falls through to UTC
      // rather than throwing inside a chat request.
    }
  }
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(now);
}

/**
 * A validated IANA-ish zone name. The value arrives from the browser and is
 * interpolated into a prompt, so it is bounded and character-restricted before
 * it goes anywhere near the model or Intl.
 */
export function sanitizeTimeZone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 64) return null;
  return /^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)*$/.test(value) ? value : null;
}

/**
 * The prompt block. Pure and deterministic so it can be asserted in tests —
 * the IO lives in `loadOperatorIdentity` below.
 *
 * Returns "" when nothing is known, so the caller can append unconditionally
 * without emitting an empty heading.
 */
export function formatOperatorIdentity(
  identity: OperatorIdentity,
  now: Date,
  timeZone?: string | null,
): string {
  const lines: string[] = [];

  if (identity.operatorName) {
    const title = identity.operatorTitle?.trim();
    lines.push(`- Operator: ${identity.operatorName}${title ? ` (${title})` : ""}`);
  }
  if (identity.firmName) lines.push(`- Firm: ${identity.firmName}`);
  lines.push(`- Today: ${formatOperatorDate(now, timeZone)}`);

  // The date alone is worth stating — it is what keeps "recent" and "this
  // quarter" anchored to now rather than to the model's training cutoff.
  return [
    "## Who you are talking to",
    ...lines,
    "Address the operator by their first name when a greeting is natural. Anchor every time-relative" +
      " claim (\"recent\", \"this quarter\", \"as of\") to today's date above, and say plainly when your" +
      " knowledge predates it.",
  ].join("\n");
}

/**
 * Look up the operator's name/title and their firm's name. Best-effort and
 * org-scoped; a failure returns nulls and the caller still answers.
 */
export async function loadOperatorIdentity(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<OperatorIdentity> {
  const empty: OperatorIdentity = { operatorName: null, operatorTitle: null, firmName: null };
  try {
    const [principalResult, orgResult] = await Promise.allSettled([
      supabase.from("principals").select("full_name, title").eq("id", userId).maybeSingle(),
      supabase.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    ]);

    const principal =
      principalResult.status === "fulfilled"
        ? (principalResult.value.data as { full_name: string | null; title: string | null } | null)
        : null;
    const org =
      orgResult.status === "fulfilled"
        ? (orgResult.value.data as { name: string | null } | null)
        : null;

    return {
      operatorName: principal?.full_name?.trim() || null,
      operatorTitle: principal?.title?.trim() || null,
      firmName: org?.name?.trim() || null,
    };
  } catch {
    return empty;
  }
}
