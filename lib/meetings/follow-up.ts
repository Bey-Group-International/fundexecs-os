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

/** Longest body this will send. A follow-up is an email, not a document. */
export const MAX_FOLLOW_UP_CHARS = 20_000;

// Who it goes to lives in lib/meetings/recipients.ts. It used to live here, and
// walked the invite list alone: `attendees` is empty for every instant meeting,
// so the commonest kind of meeting in the product could not send its own
// follow-up to the people who had just been in it. Answering that needs the
// attendance table as well as the invitation, and the report's "Email summary"
// needed the same answer, so it is one shared rule rather than two that drift.

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
