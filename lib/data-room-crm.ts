// lib/data-room-crm.ts
//
// What a data-room reader's activity looks like on their CRM record, and the
// follow-up email Earn falls back to when its model is unavailable. Pure: the
// daily writer, the follow-up action and the tests share it.
import { formatSeconds, type InvestorActivity } from "@/lib/data-room-engagement";

/** One timeline entry: what this reader did in this room on this day. */
export interface ReadingRollup {
  key: string; // `<room id>:<YYYY-MM-DD>`
  day: string;
  subject: string;
  body: string;
  occurredAt: string;
  seconds: number;
}

/**
 * The reader's activity per day for the given days, one entry each, with what
 * they read (and for how long) and what they downloaded. Days with nothing
 * but a bare open of the room still count: an investor opening the room is
 * news on their record.
 */
export function readingRollups(
  a: Pick<InvestorActivity, "timeline">,
  room: { id: string; name: string },
  days: string[],
): ReadingRollup[] {
  const out: ReadingRollup[] = [];
  for (const day of days) {
    const entries = a.timeline.filter((t) => t.day === day);
    if (entries.length === 0) continue;
    const docs = entries.filter((t) => t.documentId);
    const seconds = entries.reduce((n, t) => n + t.seconds, 0);
    const lines = docs
      .sort((x, y) => y.seconds - x.seconds)
      .map((t) =>
        [t.name, t.seconds ? `read ${formatSeconds(t.seconds)}` : t.opens ? "opened" : null, t.downloads ? "downloaded" : null]
          .filter(Boolean)
          .join(" · "),
      );
    out.push({
      key: `${room.id}:${day}`,
      day,
      subject: docs.length
        ? `Read the ${room.name} data room${seconds ? ` (${formatSeconds(seconds)})` : ""}`
        : `Opened the ${room.name} data room`,
      body: lines.length ? lines.join("\n") : "Opened the room.",
      occurredAt: entries.reduce((latest, t) => (t.lastAt > latest ? t.lastAt : latest), entries[0].lastAt),
      seconds,
    });
  }
  return out;
}

/** The UTC days the daily writer keeps current: today and yesterday. */
export function recentDays(now: Date): string[] {
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  return [yesterday, today];
}

export interface FollowUpDraft {
  subject: string;
  body: string;
  source: "earn" | "template";
}

/** A plain, short follow-up built from what the reader actually read. */
export function templateFollowUp(
  a: Pick<InvestorActivity, "documents" | "downloads">,
  ctx: { roomName: string; recipientName: string | null; senderName: string | null; nextStep: string | null },
): FollowUpDraft {
  const read = a.documents.filter((d) => d.seconds > 0 || d.downloads > 0).slice(0, 2).map((d) => d.name);
  const greeting = ctx.recipientName ? `Hi ${ctx.recipientName.split(/\s+/)[0]},` : "Hi,";
  const focus = read.length
    ? `I saw you had a look at ${read.join(" and ")} in our ${ctx.roomName} data room.`
    : `Thanks for taking a look at our ${ctx.roomName} data room.`;
  const ask = "Happy to walk you through anything in there, or answer questions on terms. Would a 30-minute call next week work?";
  const sign = ctx.senderName ? `\n\nBest,\n${ctx.senderName}` : "\n\nBest,";
  return {
    subject: `Following up on ${ctx.roomName}`,
    body: `${greeting}\n\n${focus} ${ask}${sign}`,
    source: "template",
  };
}

/** Plain text the operator edited, as the email's HTML: escaped, line breaks kept. */
export function followUpHtml(body: string): string {
  const esc = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.6; color: #111;">${esc
    .split(/\n{2,}/)
    .map((p) => `<p style="margin: 0 0 12px;">${p.replace(/\n/g, "<br />")}</p>`)
    .join("")}</div>`;
}
