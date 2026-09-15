// lib/meetings/follow-up.ts
// Sending the follow-up the report already wrote.
//
// The model is asked for "a ready-to-send professional email" — greeting,
// summary, decisions, numbered action items, next meeting, sign-off — and it
// writes one. Then the page offered a Copy button, and the host went to another
// application, pasted it, typed the attendees' addresses in by hand, and sent
// it from there. The meeting knows who was in it and the organization has a
// connected mailbox; everything needed to send it was already here.
//
// Pure. The mailbox and the send live in the route.
import { escapeHtml } from "@/lib/email";
import type { MeetingAttendeeInput } from "@/lib/meetings/attendees";

/** Longest body this will send. A follow-up is an email, not a document. */
export const MAX_FOLLOW_UP_CHARS = 20_000;

export interface FollowUpRecipient {
  name: string;
  email: string;
}

/**
 * Who the follow-up goes to.
 *
 * Everyone on the meeting who has an address, deduplicated, with the sender
 * left out — the host wrote it, and a copy of your own follow-up in your inbox
 * is noise. Anyone entered by name alone was never reachable and is not
 * silently counted as sent to.
 */
export function followUpRecipients(
  attendees: readonly MeetingAttendeeInput[] | null | undefined,
  senderEmail: string | null | undefined,
): FollowUpRecipient[] {
  const sender = (senderEmail ?? "").trim().toLowerCase();
  const seen = new Set<string>();
  const out: FollowUpRecipient[] = [];

  for (const attendee of attendees ?? []) {
    if (!attendee || typeof attendee !== "object") continue;
    const email = (attendee.email ?? "").trim().toLowerCase();
    if (!email || email === sender || seen.has(email)) continue;
    seen.add(email);
    out.push({ name: (attendee.name ?? "").trim() || email, email });
  }

  return out;
}

/** The subject line. The meeting's own title, so the thread is findable. */
export function followUpSubject(title: string | null | undefined): string {
  const clean = (title ?? "").trim();
  return clean ? `Follow-up: ${clean}` : "Meeting follow-up";
}

/**
 * The draft as it will actually be sent.
 *
 * Trimmed and capped, and empty when there is nothing to send — which the route
 * treats as a refusal rather than mailing everyone a blank page.
 */
export function followUpBody(draft: string | null | undefined): string {
  const text = (draft ?? "").trim();
  return text.length > MAX_FOLLOW_UP_CHARS ? text.slice(0, MAX_FOLLOW_UP_CHARS).trimEnd() : text;
}

/**
 * The plain-text draft as an email body.
 *
 * Escaped, because this is model output that the host may then have edited by
 * hand, and it is about to be rendered in other people's mail clients. Line
 * breaks are preserved, because the draft's numbered lists and sign-off are
 * carried entirely by them.
 */
export function followUpHtml(body: string): string {
  const paragraphs = escapeHtml(body)
    .split(/\n{2,}/)
    .map((block) => block.replace(/\n/g, "<br />"))
    .filter((block) => block.trim().length > 0);

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:sans-serif;background:#0d0d10;color:#e5e5e5;padding:32px;max-width:560px;margin:0 auto">
  <div style="margin-bottom:24px">
    <span style="font-family:monospace;font-size:13px;color:#b8a36a;letter-spacing:0.1em;text-transform:uppercase">FundExecs OS</span>
  </div>
  ${paragraphs.map((p) => `<p style="font-size:14px;line-height:1.6;margin:0 0 16px">${p}</p>`).join("\n  ")}
</body>
</html>`;
}
