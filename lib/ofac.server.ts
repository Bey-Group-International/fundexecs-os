// lib/ofac.server.ts
// Runs the first-pass OFAC screen for an LP and records what it found on their
// sanctions check.
//
// The SDN list is downloaded from the U.S. Treasury when a screen runs (it is a
// public file, about 4 MB) and matched here, so nothing about an LP is sent
// anywhere. A download that fails, or that doesn't look like the real list, ends
// the screen with an error: it must never be mistaken for "no match".
//
// What it writes, and what it never touches:
//   * a possible match -> the sanctions check is marked FLAGGED with who resembles
//     whom, which blocks approval until the fund manager records their own result;
//   * no possible match -> the check stays PENDING with a note saying so;
//   * it never marks anything clear, and it never overwrites a result the fund
//     manager recorded: only a missing check, a pending one, or one this screen
//     itself flagged earlier.
import "server-only";
import { createHash } from "node:crypto";
import { recordAudit } from "@/lib/lp-audit.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildIndex, screenNames, type ListSource, screenOutcome, SCREEN_PREFIX, type ScreenResult, type ScreenSubject, type SdnIndex } from "@/lib/ofac";

type Client = SupabaseClient<any, any, any>;

const SDN_URL = "https://www.treasury.gov/ofac/downloads/sdn.csv";
const ALT_URL = "https://www.treasury.gov/ofac/downloads/alt.csv";
const FETCH_TIMEOUT_MS = 30_000;
const CACHE_MS = 6 * 3600_000;

let cached: { at: number; index: SdnIndex } | null = null;

async function download(url: string): Promise<{ text: string; modified: string | null }> {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "User-Agent": "FundExecsOS-OFAC-screen" },
  });
  if (!res.ok) throw new Error(`OFAC download failed: ${res.status}`);
  return { text: await res.text(), modified: res.headers.get("last-modified") };
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** The SDN list, kept for a few hours so several screens in a row download it once. */
export async function loadSdnIndex(now: number = Date.now()): Promise<SdnIndex> {
  if (cached && now - cached.at < CACHE_MS) return cached.index;
  const [sdn, alt] = await Promise.all([download(SDN_URL), download(ALT_URL)]);
  const stamp = sdn.modified ? new Date(sdn.modified) : null;
  const fromHeader = !!stamp && !Number.isNaN(stamp.getTime());
  const listDate = (fromHeader ? stamp! : new Date(now)).toISOString().slice(0, 10);
  const source: ListSource = {
    sdnSha256: sha256(sdn.text),
    altSha256: sha256(alt.text),
    dateBasis: fromHeader ? "last_modified" : "fetched",
  };
  const index = buildIndex(sdn.text, alt.text, listDate, source);
  cached = { at: now, index };
  return index;
}

/** Test seam: forget the downloaded list. */
export function resetSdnCache(): void {
  cached = null;
}

export type OfacRun =
  | { ok: true; flagged: number; screened: number; wrote: boolean; result: ScreenResult }
  | { ok: false; error: string };

/** The names to screen for one LP: the LP, whoever signs for it, and everyone it listed. */
export async function subjectsFor(client: Client, sessionId: string, orgId: string): Promise<ScreenSubject[]> {
  const [{ data: session }, { data: profile }, { data: owners }] = await Promise.all([
    client.from("lp_onboarding_sessions").select("lp_name").eq("id", sessionId).eq("organization_id", orgId).maybeSingle(),
    client.from("lp_onboarding_profiles").select("legal_name, signatory_name").eq("session_id", sessionId).eq("organization_id", orgId).maybeSingle(),
    client.from("lp_onboarding_owners").select("full_name, role").eq("session_id", sessionId).eq("organization_id", orgId),
  ]);
  if (!session) return [];
  const out: ScreenSubject[] = [];
  const p = profile as { legal_name: string | null; signatory_name: string | null } | null;
  out.push({ role: "the LP", name: (p?.legal_name || (session as { lp_name: string }).lp_name || "").trim() });
  if (p?.signatory_name?.trim()) out.push({ role: "signatory", name: p.signatory_name.trim() });
  for (const o of (owners ?? []) as Array<{ full_name: string; role: string }>) {
    out.push({ role: o.role === "controller" ? "controller" : "owner", name: o.full_name.trim() });
  }
  return out.filter((s) => s.name);
}

/**
 * Screens one LP and records the outcome. `client` decides who is acting: the
 * service client for the automatic screen on submit, the fund manager's own
 * client for a re-run (so row-level security applies to it).
 */
/** Who asked for the screen. The automatic one on submit is the system's; a re-run is a fund manager's. */
export type ScreenActor = { kind: "user"; id: string } | { kind: "system" };

export async function runOfacScreen(
  client: Client,
  sessionId: string,
  orgId: string,
  opts: { now?: number; actor?: ScreenActor } = {},
): Promise<OfacRun> {
  const now = opts.now ?? Date.now();
  const actor = opts.actor ?? { kind: "system" as const };
  try {
    const subjects = await subjectsFor(client, sessionId, orgId);
    if (subjects.length === 0) return { ok: false, error: "That LP wasn't found." };

    let index: SdnIndex;
    try {
      index = await loadSdnIndex(now);
    } catch (err) {
      console.error("[ofac] could not load the SDN list", err);
      return { ok: false, error: "Couldn't get OFAC's list just now. Try again, or record your own sanctions result." };
    }

    const result = screenNames(index, subjects);
    const outcome = screenOutcome(result);

    const { data: existing } = await client
      .from("onboarding_checks")
      .select("status, summary, recorded_by")
      .eq("session_id", sessionId)
      .eq("organization_id", orgId)
      .eq("kind", "sanctions")
      .maybeSingle();
    const row = existing as { status: string; summary: string | null; recorded_by: string | null } | null;

    // Every run is logged, including one that changes nothing: that is when an
    // auditor most needs to see that the screen ran, by whom, and against which list.
    const audit = (wrote: boolean) =>
      recordAudit(client, {
        orgId,
        sessionId,
        action: "check.screen_run",
        ...(actor.kind === "user" ? { actorKind: "user" as const, actorId: actor.id } : { actorKind: "system" as const }),
        detail: {
          status: outcome.status,
          matches: result.flagged,
          screened: result.results.filter((r) => r.screened).length,
          wrote,
          list_date: result.listDate,
          list_size: result.listSize,
          // Which files, exactly: lets a later reader tell whether two screens used the same list.
          ...(result.source ? { date_basis: result.source.dateBasis, sdn_sha256: result.source.sdnSha256, alt_sha256: result.source.altSha256 } : {}),
        },
      });

    // A result a person recorded is theirs. Only a missing or pending check, or
    // a flag this screen raised itself, may be replaced.
    const ours = !!row && row.recorded_by === null && (row.summary ?? "").startsWith(SCREEN_PREFIX);
    const replaceable = !row || (row.status === "pending" && (ours || !(row.summary ?? "").trim())) || (row.status === "flagged" && ours);
    if (!replaceable) {
      await audit(false);
      return { ok: true, flagged: result.flagged, screened: result.results.filter((r) => r.screened).length, wrote: false, result };
    }

    const patch = {
      status: outcome.status,
      method: "manual",
      summary: outcome.summary,
      checked_at: outcome.status === "flagged" ? new Date(now).toISOString() : null,
      expires_at: null,
      recorded_by: null,
    };
    const { error } = row
      ? await client
          .from("onboarding_checks")
          .update(patch)
          .eq("session_id", sessionId)
          .eq("organization_id", orgId)
          .eq("kind", "sanctions")
          .eq("status", row.status)
      : await client.from("onboarding_checks").insert({ ...patch, organization_id: orgId, session_id: sessionId, kind: "sanctions" });
    if (error) {
      console.error("[ofac] could not record the screen", { code: error.code, message: error.message });
      return { ok: false, error: "Couldn't save the screen. Try again." };
    }
    await audit(true);
    return { ok: true, flagged: result.flagged, screened: result.results.filter((r) => r.screened).length, wrote: true, result };
  } catch (err) {
    console.error("[ofac] screen threw", err);
    return { ok: false, error: "Couldn't run the screen. Try again." };
  }
}
