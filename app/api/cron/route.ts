import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runAutomation } from "@/lib/engine";
import { featureAccessForOrg } from "@/lib/feature-access.server";
import { nextRun } from "@/lib/cron";
import { findDueOrgsForScan, scanOrgRadarSignals } from "@/lib/radar-scan";
import { findDuePulseOrgs, runPulseForOrg } from "@/lib/pulse.server";
import { runSlaEscalations } from "@/lib/sla-cron";
import { runWebhookDeliveries, type DeliveryStats } from "@/lib/webhooks-outbound";
import { runProactiveSweepAllOrgs } from "@/lib/proactive/orchestrate";
import { runIntelligenceSyncAllOrgs } from "@/lib/intelligence/sweep";
import { refreshStaleFeeds } from "@/lib/calendar/feeds.server";
import { syncStaleGoogleConnections } from "@/lib/calendar/google.server";
import { syncConnectedMailboxes, type MailboxSweepSummary } from "@/lib/integrations/gmail-sync/sync.server";
import { runMeetingReminders, type ReminderSweepStats } from "@/lib/meetings/reminder-sweep.server";
import {
  runBookingConfirmationRetries,
  type ConfirmationRetryStats,
} from "@/lib/meetings/booking-confirmation.server";
import { runBookingRequestExpiry, type RequestExpiryStats } from "@/lib/meetings/booking-expiry.server";
import { runBookingRequestReminders, type RequestReminderStats } from "@/lib/meetings/booking-request-reminder.server";
import { runRecordingSweep, type RecordingSweepStats } from "@/lib/meetings/recording-sweep.server";
import { runEventIdRepair } from "@/lib/calendar/event-id-repair.server";
import { NO_REPAIRS, summarize, worthReporting, type RepairStats } from "@/lib/calendar/event-id-repair";
import {
  runSubscriptionRenewals,
  applySettledInvoices,
  collectNativePayments,
  type RenewalStats,
} from "@/lib/subscriptions.server";
import { recordCronRun } from "@/lib/cron-health";
import {
  runScheduledAutomationsAllOrgs,
  type SweepStats as NetworkAutomationStats,
} from "@/lib/network-automations.server";
import type { Automation } from "@/lib/supabase/database.types";

// Each due automation plans + (if trusted) executes a full workflow via Claude.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Cap work per sweep so a backlog (or a misconfigured schedule) can't run away
// with the Anthropic budget; the next sweep picks up the remainder.
const MAX_PER_SWEEP = 10;

/**
 * GET /api/cron — the scheduled sweep (wired via vercel.json crons). Finds
 * schedule automations that are due, fires each, and advances next_run_at.
 *
 * Runs without a user session, so it uses the service-role client and scopes
 * every run to the automation's own organization. Protected by CRON_SECRET:
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically.
 */
export async function GET(request: Request) {
  // Require the secret — never run the sweep open, or any caller could trigger
  // (paid) workflow runs. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured — scheduled runs are disabled" },
      { status: 503 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Scheduled runs require SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 },
    );
  }

  const supabase = createServiceClient();
  const now = new Date();

  // Runs BEFORE the automation sweep below: automations are plan-gated
  // (lib/feature-access), so a payment that settles on this pass must start
  // the plan before its org's due automations are checked, not after.
  //
  // Subscription renewals. This is what makes a plan actually recur: FundExecs
  // owns the billing period, so nothing renews unless this sweep runs. Each due
  // subscription is billed — an invoice to settle by transfer where remittance
  // details are configured, a card charge where they are not — and the period's
  // credits are granted once that settles. An overdue invoice falls back to the
  // card on file; a failed charge goes past_due with a retry scheduled; a
  // cancelled one is closed and its entitlement dropped. Best-effort like every block in this sweep — a payment processor outage
  // never aborts the sweep, and the renewal is retried on the next pass because
  // the period end has not moved.
  let subscriptions: RenewalStats = {
    due: 0, renewed: 0, failed: 0, ended: 0, credits: 0, invoiced: 0, awaiting: 0,
  };
  // Bank debits first: ACH clears days after it is submitted, so this is where
  // an invoice actually becomes paid. Doing it before the two blocks below means
  // a payment that landed overnight starts its plan (or renews it) on this pass.
  let nativeCollections = { polled: 0, settled: 0, bounced: 0 };
  try {
    nativeCollections = await collectNativePayments(supabase, now);
  } catch (e) {
    console.error("native_payment_collection failed", e);
  }

  let settledInvoices = { applied: 0, started: 0, credits: 0 };
  try {
    // Settled invoices first: a transfer confirmed since the last sweep should
    // start its plan (or be ready for the renewal below) in the same pass,
    // rather than making the operator wait another hour for what they paid for.
    settledInvoices = await applySettledInvoices(supabase, now);
  } catch (e) {
    console.error("subscription_invoice_apply failed", e);
  }
  try {
    subscriptions = await runSubscriptionRenewals(supabase, now);
  } catch (e) {
    console.error("subscription_renewals failed", e);
  }

  const { data, error } = await supabase
    .from("automations")
    .select("*")
    .eq("enabled", true)
    .eq("trigger_type", "schedule")
    .or(`next_run_at.is.null,next_run_at.lte.${now.toISOString()}`)
    .order("next_run_at", { ascending: true, nullsFirst: true })
    .limit(MAX_PER_SWEEP);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const due = (data ?? []) as Automation[];
  const results: { id: string; status: string }[] = [];

  // Known limitations (acceptable at hourly cadence + MAX_PER_SWEEP, revisit if
  // cadence tightens): run_count is a read-then-write increment, and two
  // overlapping sweeps could both select the same row. A future hardening is an
  // atomic `UPDATE … RETURNING` claim (or a DB increment fn) to make this safe
  // under concurrency.

  for (const a of due) {
    if (!a.created_by) {
      results.push({ id: a.id, status: "skipped: no owner" });
      continue;
    }
    // Automations are plan-gated (lib/feature-access). A schedule set up while
    // the org had access must not keep running — auto-approved or not — once
    // it lapses; the run is skipped and the schedule still advances. If the
    // entitlement read itself fails, the run is left untouched and still due,
    // so a transient error never costs a paying org its run.
    let access;
    try {
      access = await featureAccessForOrg(supabase, a.organization_id, a.created_by);
    } catch (e) {
      console.error("automation access check failed", a.id, e);
      results.push({ id: a.id, status: "deferred: access check failed" });
      continue;
    }
    let status = "ok";
    try {
      if (!access.unlocked) {
        status = "skipped: plan required";
      } else {
        await runAutomation(
          { supabase, orgId: a.organization_id, actorId: a.created_by },
          { id: a.id, prompt: a.prompt, auto_approve: a.auto_approve },
        );
      }
    } catch (e) {
      status = `failed: ${e instanceof Error ? e.message : "unknown"}`;
      console.error("automation failed", a.id, e);
    }

    await supabase
      .from("automations")
      .update({
        last_run_at: now.toISOString(),
        last_run_status: status,
        run_count: a.run_count + 1,
        next_run_at: a.schedule ? nextRun(a.schedule, now)?.toISOString() ?? null : null,
      })
      .eq("organization_id", a.organization_id)
      .eq("id", a.id);

    results.push({ id: a.id, status });
  }

  // ---------------------------------------------------------------------------
  // Radar signal scan (push, not pull) — self-contained, append-only block.
  //
  // Today the radar's "why now" half only fills in when an operator manually
  // triggers a scan. Here the hourly sweep tops it up automatically: pick the
  // orgs whose freshest signal is stale (>24h, or never scanned), scoped per
  // org via the service-role client, capped at MAX_ORGS_PER_SWEEP so the signal
  // budget can't run away (mirrors MAX_PER_SWEEP above). The once-per-day
  // staleness guard means a given org is rescanned at most daily even though the
  // cron fires hourly. Best-effort: a failure here never aborts the automations
  // sweep that already ran, and reuses /api/cron (no new cron path / vercel.json
  // change). Org selection + staleness live in lib/radar-scan.ts (pure + tested).
  const radar: { scannedOrgs: number; generated: number; entities: number } = {
    scannedOrgs: 0,
    generated: 0,
    entities: 0,
  };
  try {
    const dueOrgs = await findDueOrgsForScan(supabase, now);
    radar.scannedOrgs = dueOrgs.length;
    for (const orgId of dueOrgs) {
      try {
        const r = await scanOrgRadarSignals(supabase, orgId);
        radar.generated += r.generated;
        radar.entities += r.scanned;
      } catch (e) {
        console.error("radar_scan failed", orgId, e);
      }
    }
  } catch (e) {
    console.error("radar_scan_outer failed", e);
  }

  // Market Pulse — the daily, mandate-matched web scan (lib/pulse.server.ts).
  // Each org is swept at most once per 24h (a skipped run counts, so an org out
  // of credits isn't retried hourly), one org per pass so its long-run model
  // call fits the envelope. Self-contained and best-effort like the radar block.
  const pulse: { swept: number; items: number; searches: number } = { swept: 0, items: 0, searches: 0 };
  try {
    for (const orgId of await findDuePulseOrgs(supabase, now)) {
      const r = await runPulseForOrg(supabase, orgId, { trigger: "sweep", now });
      pulse.swept += 1;
      pulse.items += r.items;
      pulse.searches += r.searches;
    }
  } catch (e) {
    console.error("pulse_sweep failed", e);
  }

  // Best-effort SLA auto-escalation: raise tracked team tasks for workflows
  // stuck past their SLA so nothing depends on someone watching the grid.
  // Defensive — runSlaEscalations never throws, but wrap anyway so it can never
  // break or block the automation sweep above.
  let escalated = 0;
  try {
    escalated = await runSlaEscalations(supabase, now);
  } catch (e) {
    console.error("sla_escalation failed", e);
    escalated = 0;
  }

  // Outbound webhook deliveries (audit P2 — v1 event subscriptions): send each
  // active endpoint its undelivered task/dispatch events as one HMAC-signed
  // batch. Best-effort like the blocks above — a delivery problem never aborts
  // the sweep, and per-endpoint failure bookkeeping lives in the module.
  let webhooks: DeliveryStats = { endpoints: 0, delivered: 0, failed: 0, disabled: 0 };
  try {
    webhooks = await runWebhookDeliveries(supabase, now);
  } catch (e) {
    console.error("webhook_deliveries failed", e);
  }

  // Proactive Initiative sweep (surface-on-open, opt-in): detect signals nobody
  // asked about, prioritize against the trust budget, author + pre-run the
  // draftable Command, and persist finished items for the Report dashboard.
  // Gated behind PROACTIVE_INITIATIVE_ENABLED (the function no-ops when off) and
  // best-effort like every block above — a failure never aborts the sweep.
  let proactive = { orgs: 0, surfaced: 0 };
  try {
    proactive = await runProactiveSweepAllOrgs(supabase, { maxOrgs: MAX_PER_SWEEP });
  } catch (e) {
    console.error("proactive_sweep failed", e);
  }

  // Native Intelligence sync (surface-on-open, opt-in): ingest each workspace's
  // connected provider feed(s) into canonical observations + assessments. Gated
  // behind INTELLIGENCE_CORE_ENABLED (the function no-ops when off) and
  // best-effort like every block above — a provider outage never aborts the
  // sweep, and previously-stored intelligence stays available regardless.
  let intelligence = { orgs: 0, fetched: 0, persisted: 0, assessed: 0 };
  try {
    intelligence = await runIntelligenceSyncAllOrgs(supabase, { maxOrgs: MAX_PER_SWEEP });
  } catch (e) {
    console.error("intelligence_sync failed", e);
  }

  // Subscribed calendar feeds: re-fetch the ones whose cached busy time has
  // aged out. This is what keeps imported availability current — a slot lookup
  // reads the cache and never fetches, so without this sweep an external
  // booking would stop blocking slots as soon as its cache went stale.
  // Best-effort: one unreachable third-party calendar never aborts the sweep,
  // and each feed's own failure count drives what its owner is told.
  let calendarFeeds = { refreshed: 0, failed: 0, skipped: 0 };
  try {
    calendarFeeds = await refreshStaleFeeds(supabase, { limit: 50 });
  } catch (e) {
    console.error("calendar_feed_refresh failed", e);
  }

  // Google Calendar connections, same reasoning as the ICS feeds above: the
  // grid and the availability lookup both read cached rows, so without this
  // sweep a meeting booked in Google would neither appear here nor block a
  // slot. Best-effort — one member's revoked grant never aborts the sweep, and
  // each connection's own failure count drives what its owner is told.
  let googleCalendars = { connections: 0, upserted: 0, deleted: 0, failed: 0 };
  try {
    googleCalendars = await syncStaleGoogleConnections(supabase, { limit: 25 });
  } catch (e) {
    console.error("google_calendar_sync failed", e);
  }

  // Connected Gmail mailboxes: what people wrote and received in Gmail itself,
  // into the inbox and from there onto each contact's timeline and the reports
  // built on it. Incremental by Gmail's history cursor, so a quiet mailbox is
  // one request. Best-effort like the calendar sync above — one org's revoked
  // grant is recorded on its own sync row and never aborts the sweep.
  let mailboxes: MailboxSweepSummary = {
    mailboxes: 0, ingested: 0, failed: 0, needsReconnect: 0, incomplete: false,
  };
  try {
    mailboxes = await syncConnectedMailboxes(supabase, { now });
  } catch (e) {
    console.error("gmail_mailbox_sync failed", e);
  }

  // Meeting reminders: `reminder_minutes` is set on the schedule screen and,
  // until this ran, was only ever honoured by Google for meetings that happened
  // to be synced there. This is what makes the setting mean something for the
  // app's own meetings. Fires once per meeting (the sweep claims the row before
  // sending), and never after the meeting has started. Best-effort like every
  // block above — one org's unconnected mailbox never aborts the sweep.
  let reminders: ReminderSweepStats = { due: 0, reminded: 0, sent: 0, failed: 0 };
  try {
    reminders = await runMeetingReminders(supabase, { now });
  } catch (e) {
    console.error("meeting_reminders failed", e);
  }

  // Booking confirmations that never reached the invitee — no host mailbox, or
  // the mail provider refusing. Re-sent (invitee's copy only) until delivered,
  // the booking stops being live, the meeting starts, or ~two days pass.
  let bookingConfirmations: ConfirmationRetryStats = { due: 0, delivered: 0, failed: 0 };
  try {
    bookingConfirmations = await runBookingConfirmationRetries(supabase, { now });
  } catch (e) {
    console.error("booking_confirmation_retries failed", e);
  }

  // Requests still waiting on their host with under a day to go: the host is
  // reminded once, so the expiry below is a last resort.
  let bookingRequestReminders: RequestReminderStats = { reminded: 0, failed: 0 };
  try {
    bookingRequestReminders = await runBookingRequestReminders(supabase, { now });
  } catch (e) {
    console.error("booking_request_reminders failed", e);
  }

  // Booking requests the host never answered, closed once their time has come
  // so the invitee hears back instead of waiting on a meeting that is over.
  let bookingRequestsExpired: RequestExpiryStats = { expired: 0, notified: 0, failed: 0 };
  try {
    bookingRequestsExpired = await runBookingRequestExpiry(supabase, { now });
  } catch (e) {
    console.error("booking_request_expiry failed", e);
  }

  // Meeting recordings: retention, closing out recordings nobody stopped, and
  // the ones whose meeting was deleted out from under them.
  //
  // Recordings are by a wide margin the most expensive thing this product
  // stores — around 675 MB per hour of meeting — and nothing else deletes them.
  // Retention that waits for somebody to remember is not retention, it is a
  // bill. This also closes out rows still claiming to be recording hours later,
  // which is a host whose tab died mid-call: the parts they did upload are kept
  // and the recording is marked complete, because those parts are a real,
  // watchable record of most of a meeting.
  let recordings: RecordingSweepStats = { expired: 0, abandoned: 0, orphaned: 0, objectsDeleted: 0, errors: 0 };
  try {
    recordings = await runRecordingSweep(supabase, now);
  } catch (e) {
    console.error("recording_sweep failed", e);
  }

  // Reattach calendar events to the meetings that lost them. For as long as the
  // sync write named a provider the check constraint rejected, every push did
  // half its job: the event landed on the host's calendar and the UPDATE that
  // would have stored its id was thrown out. Those rows do not know their event
  // exists.
  //
  // This looks the event up by the private marker the app stamps on everything
  // it creates and records the id. It does NOT re-push: every write in
  // google-write.server.ts carries `sendUpdates: "all"`, so re-pushing a backlog
  // would email every attendee of every affected meeting about a change none of
  // them made.
  //
  // Left on the schedule rather than run once, because it is idempotent — a row
  // with its id recorded no longer matches — and because a host who reconnects a
  // calendar months from now gets their rows healed on the next pass.
  let calendarRepair: RepairStats = NO_REPAIRS;
  try {
    calendarRepair = await runEventIdRepair(supabase);
    if (worthReporting(calendarRepair)) {
      console.log("[cron] calendar event id repair:", summarize(calendarRepair));
    }
  } catch (e) {
    console.error("calendar_event_id_repair failed", e);
  }

  // ---------------------------------------------------------------------------
  // Network OS automations — the three time-based triggers.
  //
  // The event triggers are evaluated inside the request that changed the row.
  // These three cannot be: "no contact for 30 days" is not caused by anybody
  // doing anything, which is exactly why it is the one a firm most wants
  // watched. The sweep asks each org's rules for their candidates and fires
  // once per row per UTC day — the dedupe key on the run log is what makes an
  // hourly sweep raise one follow-up rather than twenty-four.
  //
  // Self-contained and never throws: an automation problem must not stop the
  // renewals, reminders, or health tracking below it.
  let networkAutomations: NetworkAutomationStats = {
    orgs: 0,
    rules: 0,
    applied: 0,
    skipped: 0,
    duplicates: 0,
    failed: 0,
  };
  try {
    networkAutomations = await runScheduledAutomationsAllOrgs(supabase, now);
  } catch (e) {
    console.error("network_automations sweep failed", e);
  }

  // Last-run tracking (append-only, best-effort): record that the hourly sweep
  // ran so the pipeline's liveness is observable. Never throws; never changes the
  // response below.
  try {
    await recordCronRun(supabase, {
      job: "cron",
      status: "ok",
      detail: {
        swept: due.length,
        scannedOrgs: radar.scannedOrgs,
        generated: radar.generated,
        escalated,
        googleCalendarConnectionsSynced: googleCalendars.connections,
        googleCalendarEventsUpserted: googleCalendars.upserted,
        googleCalendarSyncFailures: googleCalendars.failed,
        gmailMailboxesSynced: mailboxes.mailboxes,
        gmailMessagesIngested: mailboxes.ingested,
        gmailMailboxFailures: mailboxes.failed,
        gmailMailboxesNeedingReconnect: mailboxes.needsReconnect,
        webhooksDelivered: webhooks.delivered,
        webhooksFailed: webhooks.failed,
        proactiveSurfaced: proactive.surfaced,
        intelligenceAssessed: intelligence.assessed,
        calendarFeedsRefreshed: calendarFeeds.refreshed,
        calendarFeedsFailed: calendarFeeds.failed,
        meetingRemindersSent: reminders.sent,
        meetingRemindersFailed: reminders.failed,
        recordingsExpired: recordings.expired,
        recordingsClosedOut: recordings.abandoned,
        recordingsOrphaned: recordings.orphaned,
        recordingObjectsDeleted: recordings.objectsDeleted,
        calendarEventIdsReattached: calendarRepair.reattached,
        calendarEventIdsMissing: calendarRepair.noEvent,
        calendarEventIdRepairFailures: calendarRepair.failed,
        subscriptionsDue: subscriptions.due,
        subscriptionsRenewed: subscriptions.renewed,
        subscriptionsFailed: subscriptions.failed,
        subscriptionsEnded: subscriptions.ended,
        subscriptionsInvoiced: subscriptions.invoiced,
        subscriptionsAwaitingPayment: subscriptions.awaiting,
        subscriptionInvoicesApplied: settledInvoices.applied,
        subscriptionsStartedByPayment: settledInvoices.started,
        bankDebitsPolled: nativeCollections.polled,
        bankDebitsSettled: nativeCollections.settled,
        bankDebitsReturned: nativeCollections.bounced,
        networkAutomationOrgs: networkAutomations.orgs,
        networkAutomationsApplied: networkAutomations.applied,
        networkAutomationsFailed: networkAutomations.failed,
      },
      startedAt: now,
    });
  } catch {
    // best-effort: never let health tracking break the cron response
  }

  return NextResponse.json({ swept: due.length, results, radar, pulse, escalated, webhooks, proactive, reminders, bookingConfirmations, bookingRequestReminders, bookingRequestsExpired, calendarRepair, subscriptions, settledInvoices, nativeCollections, networkAutomations });
}
