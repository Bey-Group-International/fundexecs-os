"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import type { RadarDigestPref } from "@/lib/supabase/database.types";
import {
  validateDigestPref,
  recipientRequired,
  type DigestPrefInput,
  type DigestChannel,
} from "@/lib/digest-prefs";
import { sendTestDigestForOrg, type TestDigestResult } from "@/lib/radar-send";

// Server actions for the Act-now Radar digest delivery preferences
// (radar_digest_prefs, migration 0062). Reads/writes go through the RLS-enforced
// server client: select is member-read, the upsert is gated by writer-write, so
// a non-writer submit is a silent policy rejection rather than a tenancy leak.
// This mirrors connections-actions.ts — auth via getSessionContext, typed
// results, revalidatePath the settings route.

// Load this org's per-channel digest prefs (one row per channel by the table's
// unique constraint). Auth-guarded; returns an empty list when unauthenticated.
export async function loadDigestPrefs(): Promise<{
  ok: boolean;
  prefs: RadarDigestPref[];
  error?: string;
}> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, prefs: [], error: "Not authenticated" };

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("radar_digest_prefs")
    .select("*")
    .eq("organization_id", ctx.orgId);

  if (error) return { ok: false, prefs: [], error: error.message };
  return { ok: true, prefs: (data as RadarDigestPref[] | null) ?? [] };
}

// Upsert one channel's prefs on the (organization_id, channel) unique key. The
// input is validated/normalized by the shared pure helper before it touches the
// DB — channel + cadence enums, min_score 0–100, recipient required for
// slack/email and forced null for in_app.
export async function upsertDigestPref(
  input: DigestPrefInput,
): Promise<{ ok: boolean; pref?: RadarDigestPref; error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not authenticated" };

  const result = validateDigestPref(input);
  if (!result.ok) return { ok: false, error: result.error };
  const { channel, recipient, cadence, min_score, enabled } = result.value;

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("radar_digest_prefs")
    .upsert(
      {
        organization_id: ctx.orgId,
        channel,
        recipient,
        cadence,
        min_score,
        enabled,
      },
      { onConflict: "organization_id,channel" },
    )
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, pref: (data as RadarDigestPref | null) ?? undefined };
}

// Build + dispatch this org's digest right now so an operator can preview
// delivery without waiting for the cron cadence. Auth-guarded via the same
// session helper; reuses the radar-send compose/dispatch path. Defaults to the
// in-app channel (always available, no creds) but honors an explicit channel —
// using the org's saved row for that channel when one exists, or a sensible
// default config otherwise. Mock-or-real safe: returns a prepared/sent result
// even with no provider credentials.
export async function sendTestDigest(
  channel: DigestChannel = "in_app",
): Promise<{ ok: boolean; result?: TestDigestResult; error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not authenticated" };

  const supabase = await createServerClient();
  // Prefer the org's saved config for this channel so the preview matches what
  // a real send would do; fall back to table defaults when no row exists yet.
  const { data: prefRow } = await supabase
    .from("radar_digest_prefs")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .eq("channel", channel)
    .maybeSingle();

  const pref = (prefRow as RadarDigestPref | null) ?? {
    channel,
    recipient: recipientRequired(channel) ? (ctx.email || null) : null,
    cadence: "daily" as const,
    min_score: 60,
  };

  const result = await sendTestDigestForOrg(supabase, ctx.orgId, {
    channel: pref.channel,
    recipient: pref.recipient,
    cadence: pref.cadence,
    min_score: pref.min_score,
  });

  return { ok: result.ok, result, error: result.ok ? undefined : result.error };
}
