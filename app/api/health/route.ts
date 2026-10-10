import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { timingSafeEqual } from "crypto";

export const dynamic = "force-dynamic";

// GET /api/health — infrastructure and feature-dependency probe.
//
// Protected with CRON_SECRET Bearer token so it is not open to the public
// (same pattern as /api/cron). Uses the service-role client so the probes
// return real results even when there are no session cookies.
//
// Beyond the original liveness probe, each check below asserts a dependency a
// shipped feature actually stands on AT RUNTIME: the table it reads and the
// database function it calls, exercised through the same client the feature
// uses. The reason is the October 2026 incident: the migration pipeline's
// credential died, three merged migrations never reached production, and the
// deployed app called database functions that did not exist — while every
// merge looked green. The schema pipeline now watches itself
// (db-migrate.yml), and this is the other half: whatever the cause — a
// stranded migration, a dropped function, a revoked grant — the feature's
// dependency failing shows up here, named, within one probe interval.
//
// Every check runs even after one fails: the answer to "what is broken" is
// the list, not the first casualty.

/**
 * The tables and functions each guarded feature stands on. One entry per
 * dependency, so a failure names the exact missing piece rather than the
 * feature. Adding a feature to the probe is adding its rows here.
 */
const TABLE_CHECKS: readonly { feature: string; table: keyof Database["public"]["Tables"] }[] = [
  // The original liveness probe: any org row proves the database answers.
  { feature: "core", table: "organizations" },
  // Live meetings and their transcripts: the save path for every spoken word,
  // the chat sidebar, and the participants roster the room is built from.
  { feature: "meetings", table: "live_meetings" },
  { feature: "meetings", table: "live_meeting_transcripts" },
  { feature: "meetings", table: "live_meeting_chat" },
  { feature: "meetings", table: "live_meeting_participants" },
  // Inbox and follow-up email: the thread store, the message store, the
  // tracked-thread table follow-ups hang off, and the Gmail sync state.
  { feature: "inbox", table: "inbox_threads" },
  { feature: "inbox", table: "inbox_messages" },
  { feature: "inbox", table: "tracked_mail_threads" },
  { feature: "inbox", table: "gmail_mailbox_sync" },
];

export interface HealthCheck {
  name: string;
  ok: boolean;
  error?: string;
}

async function runChecks(supabase: ReturnType<typeof createServiceClient>): Promise<HealthCheck[]> {
  const tableProbes = TABLE_CHECKS.map(async ({ feature, table }): Promise<HealthCheck> => {
    const name = `${feature}:${table}`;
    try {
      // `*` rather than a named column: not every probed table has an `id`
      // (gmail_mailbox_sync is keyed by organization_id), and the probe's
      // question is "does this table answer", not "what is in it". At most
      // one row is read and none of it leaves this function.
      const { error } = await supabase.from(table).select("*").limit(1);
      if (error) throw new Error(error.message);
      return { name, ok: true };
    } catch (e) {
      return { name, ok: false, error: e instanceof Error ? e.message : "unknown" };
    }
  });

  // The meeting log's "Regenerate from transcript" stands on this function
  // (migration 20261009100100). Called with an empty id list: zero rows, no
  // data touched — it either exists and answers, or it is the October failure
  // again. This is the probe that would have caught that incident.
  const fnProbe = (async (): Promise<HealthCheck> => {
    const name = "meetings:fn:live_meetings_with_transcript_rows";
    try {
      const { error } = await supabase.rpc("live_meetings_with_transcript_rows", { ids: [] });
      if (error) throw new Error(error.message);
      return { name, ok: true };
    } catch (e) {
      return { name, ok: false, error: e instanceof Error ? e.message : "unknown" };
    }
  })();

  return Promise.all([...tableProbes, fnProbe]);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  // Compare byte lengths (not string code units) before timingSafeEqual to
  // avoid a throw when the header contains multi-byte characters.
  const aBytes = Buffer.from(authHeader);
  const eBytes = Buffer.from(expected);
  const matches = aBytes.length === eBytes.length && timingSafeEqual(aBytes, eBytes);
  if (!matches) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 500 });
  }

  const ts = new Date().toISOString();
  const checks = await runChecks(createServiceClient());
  const failed = checks.filter((c) => !c.ok);
  // `db` keeps the original probe's contract for anything already reading it:
  // it reports the core database check, not the feature checks.
  const db = checks.find((c) => c.name === "core:organizations")?.ok ? "ok" : "error";
  if (failed.length > 0) {
    console.error("[health] failing checks:", failed.map((c) => `${c.name} (${c.error})`).join("; "));
    return NextResponse.json({ status: "degraded", db, ts, checks }, { status: 503 });
  }
  return NextResponse.json({ status: "ok", db, ts, checks });
}
