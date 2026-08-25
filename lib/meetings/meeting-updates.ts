// lib/meetings/meeting-updates.ts
// Notices for a meeting that already exists. Adding a guest sends an invite
// (lib/meetings/invite.ts); moving or cancelling a meeting has to reach the
// people who were already on it — that is what this module does.
//
// Two rules shape everything here:
//
//   1. Only a real change notifies. A host fixing a typo in the agenda must not
//      mail every attendee, so callers pass timing before and after and let
//      `diffMeetingTiming` decide whether anything actually moved.
//   2. Nothing throws. The edit is already saved by the time a notice goes out;
//      a dead email provider must never surface as a failed save.
import { sendEmail } from "@/lib/email";
import { buildSchedulingEmailHtml } from "@/lib/meetings/scheduling-email";
import { formatSlotFull } from "@/lib/meetings/scheduling";

export type MeetingUpdateKind = "rescheduled" | "cancelled" | "removed";

export interface MeetingTiming {
  startIso: string | null;
  durationMinutes: number | null;
}

export interface MeetingTimingChange {
  /** True when the meeting starts at a different instant than it did. */
  startChanged: boolean;
  /** True when it still starts when it did, but runs for a different length. */
  durationChanged: boolean;
  /** Either of the above — the condition that earns an attendee an email. */
  changed: boolean;
}

/** Same point in time, however the two ISO strings happen to be spelled. */
function sameInstant(a: string | null, b: string | null): boolean {
  if (!a || !b) return a === b;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  // Unparseable input falls back to an exact string match rather than reporting
  // every save as a reschedule.
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a === b;
  return ta === tb;
}

/**
 * Compare a meeting's timing across an edit. Re-saving the same instant — a
 * different ISO spelling, or a field the host never touched — is not a change.
 */
export function diffMeetingTiming(before: MeetingTiming, after: MeetingTiming): MeetingTimingChange {
  const startChanged = !sameInstant(before.startIso, after.startIso);
  const durationChanged =
    !startChanged && (before.durationMinutes ?? null) !== (after.durationMinutes ?? null);
  return { startChanged, durationChanged, changed: startChanged || durationChanged };
}

export interface MeetingUpdateContext {
  /** Canonical app origin, so the emailed link is stable across hosts/proxies. */
  origin: string;
  roomCode: string;
  title: string;
  /** Who made the change, as attendees should see it. */
  senderName: string;
  emails: string[];
  /** The meeting's timezone — the only one the app knows for a guest list. */
  timezone: string;
  startIso?: string | null;
  /** Where the meeting used to be. Shown on a reschedule so the move is legible. */
  previousStartIso?: string | null;
  durationMinutes?: number | null;
  reason?: string | null;
}

function whenIn(iso: string | null | undefined, timezone: string, durationMinutes?: number | null): string {
  if (!iso) return "";
  const stamp = formatSlotFull(iso, timezone || "UTC");
  return durationMinutes ? `${stamp} (${durationMinutes} min)` : stamp;
}

/**
 * The subject and body for one kind of update. Exported so the copy is testable
 * without a mail provider, and reuses the scheduling shell so every meeting
 * email in the product reads as one family.
 */
export function buildMeetingUpdateEmail(
  kind: MeetingUpdateKind,
  ctx: MeetingUpdateContext,
): { subject: string; html: string } {
  const joinUrl = `${(ctx.origin || "").replace(/\/$/, "")}/meeting-invite/${ctx.roomCode}`;
  const now = whenIn(ctx.startIso, ctx.timezone, ctx.durationMinutes);
  const previous = whenIn(ctx.previousStartIso, ctx.timezone);

  if (kind === "cancelled") {
    return {
      subject: `Cancelled: ${ctx.title}`,
      html: buildSchedulingEmailHtml({
        heading: "This meeting was cancelled",
        intro: `${ctx.senderName} cancelled this meeting. Nothing else is needed from you.`,
        rows: [
          ["Meeting", ctx.title],
          ["Was", now || previous],
          ["Reason", ctx.reason ?? ""],
        ],
        footnote: "You can delete it from your own calendar.",
      }),
    };
  }

  if (kind === "removed") {
    return {
      subject: `Removed: ${ctx.title}`,
      html: buildSchedulingEmailHtml({
        heading: "You were taken off this meeting",
        intro: `${ctx.senderName} updated the guest list. You're no longer expected to attend.`,
        rows: [
          ["Meeting", ctx.title],
          ["Was", now],
        ],
        footnote: "The meeting is still going ahead without you — you can drop it from your calendar.",
      }),
    };
  }

  return {
    subject: `Updated: ${ctx.title} moved to a new time`,
    html: buildSchedulingEmailHtml({
      heading: "This meeting moved",
      intro: `${ctx.senderName} changed when this meeting happens. Your calendar entry is now out of date — here's the new time.`,
      rows: [
        ["Meeting", ctx.title],
        ["New time", now],
        ["Previously", previous],
      ],
      cta: { label: "Join meeting", url: joinUrl },
      footnote: "Use the same link as before — only the time changed.",
    }),
  };
}

/**
 * Mail an update to everyone already on a meeting. Never throws — a missing
 * provider or a per-recipient failure only lowers `sent`, so the edit the host
 * already made stands either way.
 */
export async function sendMeetingUpdates(
  kind: MeetingUpdateKind,
  ctx: MeetingUpdateContext,
): Promise<{ sent: number; total: number }> {
  const emails = [...new Set(ctx.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (emails.length === 0) return { sent: 0, total: 0 };

  const { subject, html } = buildMeetingUpdateEmail(kind, ctx);

  const results = await Promise.allSettled(
    emails.map((email) =>
      sendEmail({
        to: { name: email.split("@")[0] ?? email, email },
        subject,
        htmlBody: html,
      }),
    ),
  );

  const sent = results.filter((r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok).length;
  return { sent, total: emails.length };
}
