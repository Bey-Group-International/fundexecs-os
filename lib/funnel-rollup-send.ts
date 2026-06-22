// lib/funnel-rollup-send.ts
// The server-side send for the Weekly Funnel Rollup — the I/O half of the loop.
// For each org with enabled radar_digest_prefs it builds this week's funnel
// (lib/source-funnel.buildFunnel), loads the most recent prior snapshot,
// computes + composes the rollup (lib/funnel-rollup, PURE), dispatches per
// enabled channel, then records the new snapshot so next week has a baseline.
//
//   in_app → a thread on the Unified Inbox `radar_digest` channel (+ a message),
//   slack  → the dispatch layer, pinned to the "slack" channel hint,
//   email  → the dispatch layer, routed to Gmail.
//
// MIRRORS lib/radar-send.ts: session-less + service-role (invoked from the
// /api/digest/weekly cron with no user session), scoped per org, capped per run,
// best-effort per org (one org's failure never aborts the sweep). It reuses the
// existing radar_digest_prefs (read-only) to decide WHO gets it on WHICH
// channels — the rollup rides the digest infrastructure that already exists.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { buildFunnel, type Funnel as FunnelResult } from "@/lib/source-funnel";
import { computeFunnelRollup, composeFunnelRollupMessage } from "@/lib/funnel-rollup";
import { dispatchAction } from "@/lib/integrations";

type Client = SupabaseClient<Database>;

// Cap orgs per run so a backlog can't run away; the next weekly sweep picks up
// the remainder. Mirrors radar-send's MAX_ORGS_PER_RUN.
const MAX_ORGS_PER_RUN = 25;

export interface RollupSendOutcome {
  organizationId: string;
  channels: string[];
  baseline: boolean;
  status: "sent" | "skipped" | "failed";
  detail?: string;
}

export interface RollupSendSummary {
  orgsConsidered: number;
  delivered: number;
  results: RollupSendOutcome[];
}

// Load the most recent prior funnel snapshot for an org, deserialized back into a
// Funnel. Best-effort: a missing/unreadable/malformed row → null (baseline run).
async function loadPriorSnapshot(supabase: Client, orgId: string): Promise<FunnelResult | null> {
  try {
    const { data } = await supabase
      .from("funnel_snapshots")
      .select("snapshot")
      .eq("organization_id", orgId)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const snap = (data?.snapshot ?? null) as unknown;
    if (!snap || typeof snap !== "object") return null;
    return snap as FunnelResult;
  } catch {
    return null;
  }
}

// Drop the in-app rollup into the Unified Inbox as a thread + a message, so it
// lands in the same ranked stream as every other touchpoint. Mirrors
// radar-send.deliverInApp. Best-effort.
async function deliverInApp(
  supabase: Client,
  orgId: string,
  subject: string,
  preview: string,
  body: string,
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
        intent: "Weekly funnel rollup",
        ai_summary: preview,
        priority: 50,
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) return false;
    await supabase.from("inbox_messages").insert({
      organization_id: orgId,
      thread_id: data.id as string,
      direction: "inbound",
      author: "Source Funnel",
      body,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run the weekly funnel-rollup sweep: for every org with an enabled
 * radar_digest_pref, build the current funnel, diff it against the most recent
 * snapshot, compose the rollup, dispatch to each enabled channel, and persist
 * the new snapshot. Service-role, session-less. Returns a structured summary the
 * cron endpoint surfaces. Best-effort per org.
 */
export async function sendFunnelRollups(supabase: Client): Promise<RollupSendSummary> {
  const results: RollupSendOutcome[] = [];

  // Group enabled prefs by org → the set of channels that org wants. The rollup
  // is one read per org per week; we deliver it on every channel the org enabled
  // and snapshot once. Read-only use of radar_digest_prefs.
  const channelsByOrg = new Map<string, Set<string>>();
  const recipientByOrgChannel = new Map<string, string | null>();
  try {
    const { data } = await supabase
      .from("radar_digest_prefs")
      .select("organization_id, channel, recipient, enabled")
      .eq("enabled", true)
      .order("created_at", { ascending: true });
    for (const row of (data ?? []) as Array<{
      organization_id: string;
      channel: string;
      recipient: string | null;
    }>) {
      let set = channelsByOrg.get(row.organization_id);
      if (!set) {
        if (channelsByOrg.size >= MAX_ORGS_PER_RUN) continue;
        set = new Set<string>();
        channelsByOrg.set(row.organization_id, set);
      }
      set.add(row.channel);
      recipientByOrgChannel.set(`${row.organization_id}:${row.channel}`, row.recipient ?? null);
    }
  } catch {
    // No prefs readable → nothing to send.
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || undefined;
  let delivered = 0;

  for (const [orgId, channelSet] of channelsByOrg) {
    const channels = [...channelSet];
    try {
      const current: FunnelResult = await buildFunnel(supabase, orgId);
      const prior = await loadPriorSnapshot(supabase, orgId);
      const rollup = computeFunnelRollup(current, prior);
      const message = composeFunnelRollupMessage(rollup, { cadence: "weekly", baseUrl });

      let anyOk = false;
      for (const channel of channels) {
        const recipient = recipientByOrgChannel.get(`${orgId}:${channel}`) ?? null;
        if (channel === "in_app") {
          const ok = await deliverInApp(
            supabase,
            orgId,
            message.emailSubject,
            message.inAppSummary,
            message.emailBody.text,
          );
          anyOk = anyOk || ok;
        } else if (channel === "slack") {
          const res = await dispatchAction({
            orgId,
            actorId: "system",
            action: "distribute_report",
            channel: "slack",
            target: { name: recipient ?? undefined, email: recipient ?? undefined },
            subject: message.emailSubject,
            body: message.slackMarkdown,
          });
          anyOk = anyOk || res.ok;
        } else {
          // email → Gmail adapter
          const res = await dispatchAction({
            orgId,
            actorId: "system",
            action: "distribute_report",
            channel: "gmail",
            target: { email: recipient ?? undefined },
            subject: message.emailSubject,
            body: message.emailBody.text,
          });
          anyOk = anyOk || res.ok;
        }
      }

      // Persist the new snapshot so next week diffs against it — even if every
      // dispatch failed, the read is valid and the baseline should advance.
      await supabase.from("funnel_snapshots").insert({
        organization_id: orgId,
        snapshot: current as unknown as Json,
      });

      if (anyOk) {
        delivered += 1;
        results.push({
          organizationId: orgId,
          channels,
          baseline: rollup.baseline,
          status: "sent",
          detail: rollup.baseline ? "baseline captured" : "rollup delivered",
        });
      } else {
        results.push({
          organizationId: orgId,
          channels,
          baseline: rollup.baseline,
          status: "failed",
          detail: "all channel dispatches failed",
        });
      }
    } catch (e) {
      results.push({
        organizationId: orgId,
        channels,
        baseline: false,
        status: "failed",
        detail: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  return { orgsConsidered: channelsByOrg.size, delivered, results };
}
