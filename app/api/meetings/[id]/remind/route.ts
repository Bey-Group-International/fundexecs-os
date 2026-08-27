import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { writeDashboardAudit } from "@/lib/dashboard/audit";
import { buildMeetingInviteUrl } from "@/lib/meetings/service";
import { formatSlotFull } from "@/lib/meetings/scheduling";
import { SITE_URL } from "@/lib/site";
import {
  buildReminderEmail,
  canSendReminder,
  describeTimeUntil,
  REMINDER_COOLDOWN_MS,
  type RemindableMeeting,
} from "@/lib/meetings/reminder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Email everyone on a meeting a reminder, now.
 *
 * Host-triggered rather than scheduled: `reminder_minutes` has always been
 * stored and never acted on, and a button the host presses is the honest first
 * version of that. Refusals come back as 409 with a reason meant for a person,
 * because "why can't I send this" is the question being asked.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { note?: string };
  const supabase = await createServerClient();

  try {
    const { data, error } = await supabase
      .from("live_meetings")
      .select(
        "id, title, status, scheduled_at, timezone, duration_minutes, is_draft, deleted_at, attendees, room_code, meeting_url, last_reminder_sent_at",
      )
      .eq("id", id)
      .eq("organization_id", auth.ctx.orgId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

    const meeting = data as unknown as RemindableMeeting & {
      id: string;
      timezone: string | null;
      room_code: string | null;
      meeting_url: string | null;
    };

    const verdict = canSendReminder(meeting);
    if (!verdict.ok) {
      return NextResponse.json(
        { error: verdict.reason, recipients: verdict.recipients.length },
        { status: 409 },
      );
    }

    // Claim the cooldown BEFORE sending, not after.
    //
    // canSendReminder above only reads the timestamp, so two requests arriving
    // together would both find it clear and both send — and these land in
    // external inboxes, where a duplicate is the exact thing the cooldown
    // exists to prevent. This update matches only a row whose cooldown is still
    // clear, so the database decides which request wins and the loser is turned
    // away having sent nothing.
    const claimedAt = new Date().toISOString();
    const cutoff = new Date(Date.now() - REMINDER_COOLDOWN_MS).toISOString();
    const { data: claimed, error: claimError } = await supabase
      .from("live_meetings")
      .update({ last_reminder_sent_at: claimedAt } as never)
      .eq("id", id)
      .eq("organization_id", auth.ctx.orgId)
      .or(`last_reminder_sent_at.is.null,last_reminder_sent_at.lt.${cutoff}`)
      .select("id")
      .maybeSingle();

    if (claimError) throw new Error(claimError.message);
    if (!claimed) {
      return NextResponse.json(
        { error: "A reminder just went out. Try again shortly.", recipients: verdict.recipients.length },
        { status: 409 },
      );
    }

    const joinUrl =
      meeting.meeting_url?.trim() ||
      (meeting.room_code ? buildMeetingInviteUrl(SITE_URL, meeting.room_code) : null);

    const { subject, html } = buildReminderEmail({
      title: meeting.title ?? "",
      hostName: auth.ctx.email ?? "Your host",
      whenLabel: formatSlotFull(meeting.scheduled_at!, meeting.timezone || "UTC"),
      timeUntil: describeTimeUntil(meeting.scheduled_at!),
      joinUrl,
      note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
    });

    // One failing address must not stop the rest — a reminder that reached
    // three of four people is better than one that reached nobody.
    const results = await Promise.allSettled(
      verdict.recipients.map((r) =>
        sendEmail({ orgId: auth.ctx.orgId, to: r, subject, htmlBody: html }),
      ),
    );
    const sent = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;

    // A claim that bought nothing is given back. A send that reached nobody —
    // no mailbox connected, say — must not lock the host out for ten minutes
    // with nothing to show for it, which is why the claim is released here
    // rather than left standing.
    let cooldownReleased = true;
    if (sent === 0) {
      // supabase-js resolves with { error } rather than throwing, so discarding
      // this result would silently strand the claim.
      const { error: releaseError } = await supabase
        .from("live_meetings")
        .update({ last_reminder_sent_at: meeting.last_reminder_sent_at ?? null } as never)
        .eq("id", id)
        .eq("organization_id", auth.ctx.orgId);
      if (releaseError) {
        cooldownReleased = false;
        console.error("[meetings/remind] could not release the reminder cooldown", releaseError.message);
      }
    } else {
      await writeDashboardAudit({
        organizationId: auth.ctx.orgId,
        principalId: auth.ctx.userId,
        action: "meeting.reminder_sent",
        entityType: "live_meeting",
        entityId: id,
        afterState: { sent, total: verdict.recipients.length },
      });
    }

    return NextResponse.json(
      {
        sent,
        total: verdict.recipients.length,
        // A connected mailbox is the usual reason nothing left, and the host
        // cannot guess that from a bare zero.
        error: sent === 0 ? "Could not send — no mailbox is connected for this organization." : undefined,
        // Nothing was sent and the claim could not be given back, so the button
        // will refuse for the next ten minutes over a send that never happened.
        // Better to say so than leave the host guessing at the refusal.
        warning: cooldownReleased
          ? undefined
          : "Nothing was sent, but the cooldown could not be cleared — the next attempt may be refused for up to ten minutes.",
      },
      { status: sent > 0 ? 200 : 502 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send reminder" },
      { status: 500 },
    );
  }
}
