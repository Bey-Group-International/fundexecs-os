// lib/radar-send.ts
// The server-side send for the Act-now Radar digest — the I/O half of the
// feature. For each org with enabled, due delivery prefs it builds the radar
// (lib/source-radar), composes the multi-channel payload (lib/radar-digest,
// PURE), dispatches per channel, and writes a radar_digest_log row.
//
//   in_app → a thread on the Unified Inbox `radar_digest` channel (+ a message),
//   slack  → the dispatch layer, pinned to the "slack" channel hint,
//   email  → the dispatch layer, routed to Gmail.
//
// Session-less and service-role: invoked from the /api/digest cron without a
// user session, so it scopes every write to the pref's own organization. Capped
// per run so a backlog can't run away. Best-effort per org: one org's failure
// never aborts the sweep.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, RadarDigestPref } from "@/lib/supabase/database.types";
import { buildRadar } from "@/lib/source-radar";
import { composeDigest, type DigestItem } from "@/lib/radar-digest";
import { dispatchAction } from "@/lib/integrations";

type Client = SupabaseClient<Database>;

// Cap orgs per run so a backlog (or many orgs going live at once) can't run away;
// the next sweep picks up the remainder.
const MAX_ORGS_PER_RUN = 25;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RadarSendOutcome {
  organizationId: string;
  channel: string;
  itemCount: number;
  status: "sent" | "skipped" | "failed";
  detail?: string;
}

export interface RadarSendSummary {
  orgsConsidered: number;
  delivered: number;
  results: RadarSendOutcome[];
}

// --- Pure cadence helper (unit-testable) ------------------------------------

/**
 * True when a pref is due to send given the last send time and now. Daily sends
 * once per ~day, weekly once per ~7 days. A never-sent pref is always due. Pure.
 */
export function isPrefDue(
  pref: Pick<RadarDigestPref, "cadence">,
  lastSentAt: string | null,
  now: number = Date.now(),
): boolean {
  if (!lastSentAt) return true;
  const last = new Date(lastSentAt).getTime();
  if (!Number.isFinite(last)) return true;
  const windowMs = (pref.cadence === "weekly" ? 7 : 1) * DAY_MS;
  // Small slack so a cron a few minutes early still fires.
  return now - last >= windowMs - 5 * 60 * 1000;
}

// --- I/O --------------------------------------------------------------------

async function lastSentAt(supabase: Client, orgId: string, channel: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("radar_digest_log")
      .select("sent_at")
      .eq("organization_id", orgId)
      .eq("channel", channel)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.sent_at as string | undefined) ?? null;
  } catch {
    return null;
  }
}

// Drop the in-app digest into the Unified Inbox as a thread + a message, so it
// lands in the same ranked stream as every other touchpoint that needs the
// operator. Best-effort.
async function deliverInApp(
  supabase: Client,
  orgId: string,
  subject: string,
  preview: string,
  body: string,
  priority: number,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("inbox_threads")
      .insert({
        organization_id: orgId,
        channel: "radar_digest",
        category: "messaging",
        subject,
        preview,
        intent: "Act-now Radar digest",
        ai_summary: preview,
        priority: Math.max(0, Math.min(100, priority)),
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) return false;
    await supabase.from("inbox_messages").insert({
      organization_id: orgId,
      thread_id: data.id as string,
      direction: "inbound",
      author: "Source Radar",
      body,
    });
    return true;
  } catch {
    return false;
  }
}

function topItemsSnapshot(items: DigestItem[]): Json {
  return items.map((it) => ({
    name: it.name,
    score: it.score,
    move: it.moveLabel,
    href: it.moveHref,
  }));
}

/**
 * Run the digest sweep: for every enabled pref that is due, build + compose +
 * dispatch the digest and log the send. Service-role, session-less. Returns a
 * structured summary the cron endpoint surfaces.
 */
export async function sendRadarDigests(supabase: Client): Promise<RadarSendSummary> {
  const results: RadarSendOutcome[] = [];

  let prefs: RadarDigestPref[] = [];
  try {
    const { data } = await supabase
      .from("radar_digest_prefs")
      .select("*")
      .eq("enabled", true)
      .order("created_at", { ascending: true })
      .limit(MAX_ORGS_PER_RUN);
    prefs = (data ?? []) as RadarDigestPref[];
  } catch {
    prefs = [];
  }

  const now = Date.now();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || undefined;
  // The secret digest-tracking links are signed with. Falls back to CRON_SECRET
  // so the implicit-feedback loop works out of the box where the cron already
  // has a secret. Absent → links stay plain deep links (digest never breaks).
  const trackSecret = process.env.DIGEST_TRACK_SECRET || process.env.CRON_SECRET || undefined;
  let delivered = 0;

  for (const pref of prefs) {
    const last = await lastSentAt(supabase, pref.organization_id, pref.channel);
    if (!isPrefDue(pref, last, now)) {
      results.push({
        organizationId: pref.organization_id,
        channel: pref.channel,
        itemCount: 0,
        status: "skipped",
        detail: "not due",
      });
      continue;
    }

    try {
      const items = await buildRadar(supabase, pref.organization_id, { limit: 20 });
      const baseOpts = {
        minScore: pref.min_score,
        cadence: (pref.cadence === "weekly" ? "weekly" : "daily") as "daily" | "weekly",
        baseUrl,
      };
      // First pass (no tracking) just to learn the count + snapshot before we
      // commit a log row. The deliverable payload is re-composed WITH tracking
      // below, once we have the log id to attribute engagement to.
      const preview = composeDigest(items, baseOpts);

      // Nothing clears the bar — record the consideration but don't push noise.
      if (preview.count === 0) {
        results.push({
          organizationId: pref.organization_id,
          channel: pref.channel,
          itemCount: 0,
          status: "skipped",
          detail: "no items clear the bar",
        });
        continue;
      }

      // Write the log row UP FRONT so its id can sign the engagement links. The
      // snapshot is identical to the delivered digest (tracking only rewrites
      // hrefs, never the items). Best-effort: if the log write fails we fall back
      // to an untracked digest rather than dropping the send.
      let digestLogId: string | null = null;
      try {
        const { data: logRow } = await supabase
          .from("radar_digest_log")
          .insert({
            organization_id: pref.organization_id,
            channel: pref.channel,
            item_count: preview.count,
            top_items: topItemsSnapshot(preview.topItems),
          })
          .select("id")
          .single();
        digestLogId = (logRow?.id as string | undefined) ?? null;
      } catch {
        digestLogId = null;
      }

      // Re-compose with engagement tracking when we have a secret + log id AND
      // the channel benefits from it. The in-app inbox keeps raw deep links (no
      // tracking needed in-app); only Slack/email links get wrapped.
      const wantsTracking = pref.channel === "slack" || pref.channel === "email";
      const payload =
        trackSecret && digestLogId && wantsTracking
          ? composeDigest(items, {
              ...baseOpts,
              tracking: {
                secret: trackSecret,
                digestLogId,
                orgId: pref.organization_id,
              },
            })
          : preview;

      let detail = "";
      if (pref.channel === "in_app") {
        const ok = await deliverInApp(
          supabase,
          pref.organization_id,
          payload.emailSubject,
          payload.inAppSummary,
          payload.emailBody.text,
          payload.topItems[0]?.score ?? 0,
        );
        detail = ok ? "inbox thread created" : "inbox write failed";
        if (!ok) {
          results.push({
            organizationId: pref.organization_id,
            channel: pref.channel,
            itemCount: payload.count,
            status: "failed",
            detail,
          });
          continue;
        }
      } else if (pref.channel === "slack") {
        const res = await dispatchAction({
          orgId: pref.organization_id,
          actorId: "system",
          action: "distribute_report",
          channel: "slack",
          target: { name: pref.recipient ?? undefined, email: pref.recipient ?? undefined },
          subject: payload.emailSubject,
          body: payload.slackMarkdown,
        });
        detail = res.detail;
        if (!res.ok) {
          results.push({
            organizationId: pref.organization_id,
            channel: pref.channel,
            itemCount: payload.count,
            status: "failed",
            detail: res.error ?? detail,
          });
          continue;
        }
      } else {
        // email
        const res = await dispatchAction({
          orgId: pref.organization_id,
          actorId: "system",
          action: "distribute_report",
          channel: "gmail",
          target: { email: pref.recipient ?? undefined },
          subject: payload.emailSubject,
          body: payload.emailBody.text,
        });
        detail = res.detail;
        if (!res.ok) {
          results.push({
            organizationId: pref.organization_id,
            channel: pref.channel,
            itemCount: payload.count,
            status: "failed",
            detail: res.error ?? detail,
          });
          continue;
        }
      }

      // The send is logged up front (so its id can sign engagement links). If
      // that early write failed we record the send here as a best-effort backstop
      // so cadence stays observable even when tracking attribution was skipped.
      if (!digestLogId) {
        await supabase.from("radar_digest_log").insert({
          organization_id: pref.organization_id,
          channel: pref.channel,
          item_count: payload.count,
          top_items: topItemsSnapshot(payload.topItems),
        });
      }

      delivered += 1;
      results.push({
        organizationId: pref.organization_id,
        channel: pref.channel,
        itemCount: payload.count,
        status: "sent",
        detail,
      });
    } catch (e) {
      results.push({
        organizationId: pref.organization_id,
        channel: pref.channel,
        itemCount: 0,
        status: "failed",
        detail: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  return { orgsConsidered: prefs.length, delivered, results };
}
