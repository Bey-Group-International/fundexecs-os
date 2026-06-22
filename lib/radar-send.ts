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
import {
  pickVariant,
  pickSendTimeVariant,
  SUBJECT_LINE_EXPERIMENT,
  SEND_TIME_EXPERIMENT,
  type SubjectVariant,
  type SendTimeVariant,
} from "@/lib/digest-experiments";
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

/**
 * The cadence bucket a send falls in, used as the deterministic A/B period key
 * (lib/digest-experiments.pickVariant). Daily → an ISO date ("2026-06-22");
 * weekly → an ISO-ish year-week ("2026-W25"). Stable within a period so an org
 * keeps one variant across that period's sends, then reshuffles next period.
 * Pure given `now`.
 */
export function periodKey(cadence: "daily" | "weekly", now: number = Date.now()): string {
  const d = new Date(now);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  if (cadence !== "weekly") return `${yyyy}-${mm}-${dd}`;
  // ISO week number (UTC), Thursday-anchored.
  const t = new Date(Date.UTC(yyyy, d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
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
      const cadence = (pref.cadence === "weekly" ? "weekly" : "daily") as "daily" | "weekly";
      const baseOpts = {
        minScore: pref.min_score,
        cadence,
        baseUrl,
      };
      // First pass (no tracking, no subject override) just to learn the count +
      // default subject + snapshot before we commit a log row. The deliverable
      // payload is re-composed WITH the A/B subject + tracking below, once we
      // have the log id to attribute engagement to.
      const preview = composeDigest(items, baseOpts);

      // Deterministically assign a subject-line A/B variant for this org + period.
      // Same (org, period) → same variant, so the brief's subject framing is
      // stable within a period and a test can pin it. The variant rewrites only
      // the subject/header (lib/digest-experiments); the default path is untouched
      // when 'control' is chosen.
      const periodKeyForRun = periodKey(cadence, now);
      const variant: SubjectVariant = pickVariant(
        pref.organization_id,
        periodKeyForRun,
      );
      // Independent send-time A/B assignment for the same (org, period). Same
      // ledger table, experiment_key='send_time'; recorded + measurable via the
      // same engagement telemetry. (Does not yet gate delivery to the window —
      // that's a follow-up; see PR notes.)
      const sendTimeVariant: SendTimeVariant = pickSendTimeVariant(
        pref.organization_id,
        periodKeyForRun,
      );
      const variantSubject = variant.render({
        defaultSubject: preview.emailSubject,
        count: preview.count,
        topName: preview.topItems[0]?.name ?? null,
        cadenceLabel: cadence === "weekly" ? "Weekly" : "Daily",
      });

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

      // Persist the A/B assignment for this send (best-effort: a failure here
      // never breaks the send — it only costs the experiment a data point). Tied
      // to the log row so engagement (radar_digest_engagement) joins via
      // digest_log_id to attribute opens/clicks back to the variant.
      if (digestLogId) {
        try {
          await supabase.from("digest_experiment_variants").insert([
            {
              organization_id: pref.organization_id,
              digest_log_id: digestLogId,
              experiment_key: SUBJECT_LINE_EXPERIMENT,
              variant: variant.key,
            },
            {
              organization_id: pref.organization_id,
              digest_log_id: digestLogId,
              experiment_key: SEND_TIME_EXPERIMENT,
              variant: sendTimeVariant.key,
            },
          ]);
        } catch {
          // swallow — telemetry only, never block the send.
        }
      }

      // Re-compose with the assigned subject variant, plus engagement tracking
      // when we have a secret + log id AND the channel benefits from it. The
      // in-app inbox keeps raw deep links (no tracking needed in-app); only
      // Slack/email links get wrapped.
      const wantsTracking = pref.channel === "slack" || pref.channel === "email";
      const payload =
        trackSecret && digestLogId && wantsTracking
          ? composeDigest(items, {
              ...baseOpts,
              subject: variantSubject,
              tracking: {
                secret: trackSecret,
                digestLogId,
                orgId: pref.organization_id,
              },
            })
          : composeDigest(items, { ...baseOpts, subject: variantSubject });

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

// --- Single-org test send ----------------------------------------------------

export interface TestDigestResult {
  /** True when the digest was composed + handed to dispatch without error. */
  ok: boolean;
  /** The channel that handled it ("in_app" | "slack" | "email"). */
  channel: string;
  /** How many rows cleared the bar (0 = empty-state brief). */
  itemCount: number;
  /** True only when a real external call was made (mock mode → false). */
  live: boolean;
  /** Human-readable outcome, surfaced to the operator. */
  detail: string;
  error?: string;
}

/**
 * Build + dispatch ONE org's digest immediately to a single channel — the engine
 * behind the "Send me a test digest now" action. Additive: it reuses the same
 * compose path (lib/radar-digest) and dispatch layer (lib/integrations) as the
 * sweep, but bypasses cadence/due gating (a test is always "due") and does NOT
 * write the radar_digest_log / A/B ledger (a preview is not a tracked send).
 *
 * Mock-or-real safe: with no provider creds the dispatch layer returns a
 * well-formed "prepared" result (live=false), so a test send works in any
 * environment. Never throws — failures come back as { ok:false }.
 *
 * `pref` is the channel/recipient/min_score config to preview with; callers can
 * synthesize one when an org has no saved row yet.
 */
export async function sendTestDigestForOrg(
  supabase: Client,
  orgId: string,
  pref: Pick<RadarDigestPref, "channel" | "recipient" | "cadence" | "min_score">,
): Promise<TestDigestResult> {
  const channel = pref.channel;
  try {
    const items = await buildRadar(supabase, orgId, { limit: 20 });
    const cadence = (pref.cadence === "weekly" ? "weekly" : "daily") as "daily" | "weekly";
    const payload = composeDigest(items, {
      minScore: pref.min_score,
      cadence,
      baseUrl: process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || undefined,
      subject: `[Test] ${composeDigest(items, { minScore: pref.min_score, cadence }).emailSubject}`,
    });

    if (channel === "in_app") {
      const ok = await deliverInApp(
        supabase,
        orgId,
        payload.emailSubject,
        payload.inAppSummary,
        payload.emailBody.text,
        payload.topItems[0]?.score ?? 0,
      );
      return {
        ok,
        channel,
        itemCount: payload.count,
        live: ok,
        detail: ok ? "Test digest dropped into your Unified Inbox." : "Inbox write failed.",
        error: ok ? undefined : "inbox write failed",
      };
    }

    if (channel === "slack") {
      const res = await dispatchAction({
        orgId,
        actorId: "system",
        action: "distribute_report",
        channel: "slack",
        target: { name: pref.recipient ?? undefined, email: pref.recipient ?? undefined },
        subject: payload.emailSubject,
        body: payload.slackMarkdown,
      });
      return {
        ok: res.ok,
        channel,
        itemCount: payload.count,
        live: res.live,
        detail: res.detail,
        error: res.error,
      };
    }

    // email
    const res = await dispatchAction({
      orgId,
      actorId: "system",
      action: "distribute_report",
      channel: "gmail",
      target: { email: pref.recipient ?? undefined },
      subject: payload.emailSubject,
      body: payload.emailBody.text,
    });
    return {
      ok: res.ok,
      channel,
      itemCount: payload.count,
      live: res.live,
      detail: res.detail,
      error: res.error,
    };
  } catch (e) {
    return {
      ok: false,
      channel,
      itemCount: 0,
      live: false,
      detail: "Could not build the test digest.",
      error: e instanceof Error ? e.message : "unknown",
    };
  }
}
