"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import type { RadarDigestPref } from "@/lib/supabase/database.types";
import { validateDigestPref, type DigestPrefInput } from "@/lib/digest-prefs";

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

  const supabase = createServerClient();
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

  const supabase = createServerClient();
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
