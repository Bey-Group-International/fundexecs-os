// lib/pep.server.ts
// Runs the first-pass PEP screen for an LP and records what it found on their PEP
// check. Rules are in lib/pep.ts. It sends NAMES to the configured screening
// provider (see PEP_SCREEN_* in .env.example); nothing else about the LP leaves.
//
// What it writes, and what it never touches (the same as the OFAC screen):
//   * a possible match -> the PEP check is marked FLAGGED with who resembles whom,
//     which blocks approval until the fund manager records their own result;
//   * no possible match -> the check stays PENDING with a note saying so;
//   * it never marks anything clear, and it never overwrites a result a person
//     recorded: only a missing check, a pending one, or one this screen itself
//     flagged earlier;
//   * a provider that is down, refuses the key, or answers with something
//     unreadable ends the screen with an error and writes nothing.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAudit } from "@/lib/lp-audit.server";
import { subjectsFor, type ScreenActor } from "@/lib/ofac.server";
import { PEP_SCREEN_PREFIX, parsePepResponse, pepConfig, pepOutcome, pepQueries, pepRequestBody, type PepResult } from "@/lib/pep";

type Client = SupabaseClient<any, any, any>;

const FETCH_TIMEOUT_MS = 30_000;

export type PepRun =
  | { ok: true; flagged: number; screened: number; wrote: boolean; result: PepResult }
  | { ok: false; error: string };

export async function runPepScreen(
  client: Client,
  sessionId: string,
  orgId: string,
  opts: { now?: number; actor?: ScreenActor; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {},
): Promise<PepRun> {
  const now = opts.now ?? Date.now();
  const actor = opts.actor ?? { kind: "system" as const };
  const config = pepConfig(opts.env ?? process.env);
  if (!config) return { ok: false, error: "PEP screening isn't set up for this workspace. Record your own PEP result." };

  try {
    const subjects = await subjectsFor(client, sessionId, orgId);
    if (subjects.length === 0) return { ok: false, error: "That LP wasn't found." };
    const queries = pepQueries(subjects);
    if (queries.length === 0) return { ok: false, error: "There are no names long enough to screen." };

    let result: PepResult | null;
    try {
      const res = await (opts.fetchImpl ?? fetch)(`${config.apiUrl}/match/${config.dataset}`, {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "content-type": "application/json", authorization: `ApiKey ${config.apiKey}`, "user-agent": "FundExecsOS-PEP-screen" },
        body: JSON.stringify(pepRequestBody(queries)),
      });
      if (!res.ok) {
        // The status only; never the body (it could echo the names) and never the key.
        console.error("[pep] provider refused the request", { status: res.status });
        return { ok: false, error: "The PEP screening service didn't accept the request. Try again later, or record your own PEP result." };
      }
      result = parsePepResponse(await res.json(), queries, { dataset: config.dataset, now });
    } catch (err) {
      console.error("[pep] could not reach the provider", err instanceof Error ? err.name : "error");
      return { ok: false, error: "Couldn't reach the PEP screening service just now. Try again, or record your own PEP result." };
    }
    if (!result) {
      console.error("[pep] provider answered with something unreadable");
      return { ok: false, error: "The PEP screening service gave an answer we couldn't read, so nothing was recorded. Record your own PEP result." };
    }

    const outcome = pepOutcome(result);
    const { data: existing } = await client
      .from("onboarding_checks")
      .select("status, summary, recorded_by")
      .eq("session_id", sessionId)
      .eq("organization_id", orgId)
      .eq("kind", "pep")
      .maybeSingle();
    const row = existing as { status: string; summary: string | null; recorded_by: string | null } | null;

    // Every run is logged, including one that changes nothing. Counts and the
    // provider only: never a name, and never the provider's answer.
    const audit = (wrote: boolean) =>
      recordAudit(client, {
        orgId,
        sessionId,
        action: "check.screen_run",
        ...(actor.kind === "user" ? { actorKind: "user" as const, actorId: actor.id } : { actorKind: "system" as const }),
        detail: { kind: "pep", status: outcome.status, matches: result!.flagged, screened: result!.results.length, wrote, provider: result!.provider, dataset: result!.dataset },
      });

    const ours = !!row && row.recorded_by === null && (row.summary ?? "").startsWith(PEP_SCREEN_PREFIX);
    const replaceable = !row || (row.status === "pending" && (ours || !(row.summary ?? "").trim())) || (row.status === "flagged" && ours);
    const counts = { flagged: result.flagged, screened: result.results.length, result };
    if (!replaceable) {
      await audit(false);
      return { ok: true, ...counts, wrote: false };
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
      ? await client.from("onboarding_checks").update(patch).eq("session_id", sessionId).eq("organization_id", orgId).eq("kind", "pep").eq("status", row.status)
      : await client.from("onboarding_checks").insert({ ...patch, organization_id: orgId, session_id: sessionId, kind: "pep" });
    if (error) {
      console.error("[pep] could not record the screen", { code: error.code, message: error.message });
      return { ok: false, error: "Couldn't save the screen. Try again." };
    }
    await audit(true);
    return { ok: true, ...counts, wrote: true };
  } catch (err) {
    console.error("[pep] screen threw", err instanceof Error ? err.name : "error");
    return { ok: false, error: "Couldn't run the screen. Try again." };
  }
}
