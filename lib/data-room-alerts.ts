// lib/data-room-alerts.ts
//
// The pure half of data-room alerts: who counts as "the same reader", how a
// day's activity on a link is summarised, and the two emails the link's
// creator receives. Kept free of I/O so all of it is unit-tested; the sending
// lives in data-room-alerts.server.ts.
import { escapeHtml } from "@/lib/email";

/** Visitor ids come from the reader's browser, so they are untrusted: bound them. */
const VISITOR_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * The identity a first-open alert is deduplicated on. An email the reader
 * proved to the gate (or the recipient the link was made for) wins; otherwise
 * a per-browser id, so an ungated link alerts once per reader, not per load.
 * Null when there is nothing to key on — no alert is better than one per load.
 */
export function viewerKeyFor(email: string | null | undefined, visitorId: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  if (e) return `email:${e}`;
  const v = visitorId?.trim();
  if (v && VISITOR_ID.test(v)) return `visitor:${v}`;
  return null;
}

export interface ViewRow {
  viewer_email: string | null;
  session_id: string | null;
  document_id: string | null;
  kind: string;
  duration_seconds: number | null;
  created_at: string;
}

export interface LinkDigest {
  /** Distinct readers: by email where known, else by browser session. */
  readers: number;
  /** Named readers, most engaged first. */
  namedReaders: string[];
  /** Times the room was opened. */
  opens: number;
  seconds: number;
  /** Documents by time spent, then by opens. */
  topDocuments: { documentId: string; seconds: number; opens: number }[];
}

export function summarizeViews(rows: ViewRow[]): LinkDigest | null {
  if (rows.length === 0) return null;
  const readers = new Set<string>();
  const byEmail = new Map<string, number>();
  const docs = new Map<string, { seconds: number; opens: number }>();
  let opens = 0;
  let seconds = 0;

  for (const r of rows) {
    const who = r.viewer_email?.toLowerCase() || (r.session_id ? `s:${r.session_id}` : null);
    if (who) readers.add(who);
    const secs = Math.max(0, r.duration_seconds ?? 0);
    seconds += secs;
    if (r.viewer_email) {
      const e = r.viewer_email.toLowerCase();
      byEmail.set(e, (byEmail.get(e) ?? 0) + secs + 1);
    }
    // A row with no duration is an open (page load or file fetch); a row with
    // one is time spent reading.
    if (r.kind === "room" && !r.duration_seconds) opens += 1;
    if (r.document_id) {
      const d = docs.get(r.document_id) ?? { seconds: 0, opens: 0 };
      if (r.duration_seconds) d.seconds += secs;
      else d.opens += 1;
      docs.set(r.document_id, d);
    }
  }

  return {
    // An open with no email and no session still means someone was there.
    readers: Math.max(readers.size, opens > 0 ? 1 : 0),
    namedReaders: [...byEmail.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e),
    opens,
    seconds,
    topDocuments: [...docs.entries()]
      .map(([documentId, d]) => ({ documentId, ...d }))
      .sort((a, b) => b.seconds - a.seconds || b.opens - a.opens)
      .slice(0, 5),
  };
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

function shell(body: string, footer: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #111111; border: 1px solid #222222; border-radius: 12px; overflow: hidden;">
    <div style="padding: 6px 24px; background: #F59E0B;">
      <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: #0a0a0a; text-transform: uppercase;">FundExecs OS</span>
    </div>
    <div style="padding: 32px 24px;">${body}</div>
    <div style="padding: 16px 24px; border-top: 1px solid #222222;">
      <p style="margin: 0; font-size: 11px; color: #555555;">${footer}</p>
    </div>
  </div>
</body>
</html>`;
}

function button(href: string, text: string): string {
  const safe = /^https?:\/\//i.test(href) ? href : "#";
  return `<a href="${escapeHtml(safe)}" style="display: inline-block; background: #F59E0B; color: #0a0a0a; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 700; margin-top: 24px;">${escapeHtml(text)}</a>`;
}

export function firstOpenEmail(args: {
  linkLabel: string | null;
  roomName: string | null;
  viewerEmail: string | null;
  activityUrl: string;
}): { subject: string; html: string } {
  const label = escapeHtml(args.linkLabel || "your data room link");
  const room = args.roomName ? ` in <strong style="color: #F5F5F5;">${escapeHtml(args.roomName)}</strong>` : "";
  const who = args.viewerEmail ? escapeHtml(args.viewerEmail) : "Someone";
  const subject = args.viewerEmail
    ? `${args.viewerEmail} opened ${args.linkLabel || "your data room"}`
    : `Your data room link ${args.linkLabel ? `“${args.linkLabel}” ` : ""}was opened`;
  const html = shell(
    `<h1 style="margin: 0 0 8px; font-size: 22px; color: #F5F5F5; font-weight: 700;">${who} opened your link</h1>
      <p style="margin: 0; font-size: 15px; color: #AAAAAA;">First open of <strong style="color: #F5F5F5;">${label}</strong>${room}. You won't get another email for this reader on this link.</p>
      ${button(args.activityUrl, "See their activity")}`,
    "You get this because “Notify me when this link is opened” is on for this link.",
  );
  return { subject, html };
}

export interface HotInvestor {
  /** `email:…` or `visitor:…`, as Earn's reads store it. */
  viewerKey: string;
  roomName: string | null;
  summary: string;
  followUp: string;
}

/** How a reader is named in an email: their address, or that they gave none. */
export function readerName(viewerKey: string): string {
  return viewerKey.startsWith("email:") ? viewerKey.slice("email:".length) : "A reader who gave no email";
}

function hottestSection(hot: HotInvestor[]): string {
  if (hot.length === 0) return "";
  const items = hot
    .slice(0, 5)
    .map(
      (h) => `<li style="margin-top: 10px;">
          <span style="color: #F5F5F5; font-weight: 600;">${escapeHtml(readerName(h.viewerKey))}</span>${
            h.roomName ? ` <span style="color: #888888;">· ${escapeHtml(h.roomName)}</span>` : ""
          }<br />
          <span style="color: #AAAAAA;">${escapeHtml(h.summary)}</span><br />
          <span style="color: #F59E0B;">Next: ${escapeHtml(h.followUp)}</span>
        </li>`,
    )
    .join("");
  return `<div style="margin-top: 20px; padding: 14px 16px; border: 1px solid #3a2f12; border-radius: 10px; background: #17130a;">
        <p style="margin: 0; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; color: #F59E0B; text-transform: uppercase;">Hottest investors · Earn</p>
        <ul style="margin: 0; padding-left: 18px; font-size: 13px;">${items}</ul>
      </div>`;
}

export function digestEmail(args: {
  links: { label: string | null; roomName: string | null; digest: LinkDigest; documentNames: Map<string, string> }[];
  activityUrl: string;
  /** Earn's hottest investors across these rooms, most recent first. */
  hottest?: HotInvestor[];
}): { subject: string; html: string } {
  const totalReaders = args.links.reduce((n, l) => n + l.digest.readers, 0);
  const subject = `Data room activity: ${totalReaders} reader${totalReaders === 1 ? "" : "s"} in the last day`;
  const sections = args.links
    .map(({ label, roomName, digest, documentNames }) => {
      const title = escapeHtml(label || roomName || "Data room link");
      const who = digest.namedReaders.length
        ? `<p style="margin: 6px 0 0; font-size: 13px; color: #AAAAAA;">${digest.namedReaders.slice(0, 5).map(escapeHtml).join(", ")}${
            digest.namedReaders.length > 5 ? ` and ${digest.namedReaders.length - 5} more` : ""
          }</p>`
        : "";
      const docs = digest.topDocuments.length
        ? `<ul style="margin: 8px 0 0; padding-left: 18px; font-size: 13px; color: #AAAAAA;">${digest.topDocuments
            .map((d) => {
              const name = escapeHtml(documentNames.get(d.documentId) ?? "A document");
              const stat = d.seconds > 0 ? formatDuration(d.seconds) : `${d.opens} open${d.opens === 1 ? "" : "s"}`;
              return `<li>${name} · ${stat}</li>`;
            })
            .join("")}</ul>`
        : "";
      return `<div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #222222;">
        <p style="margin: 0; font-size: 15px; color: #F5F5F5; font-weight: 600;">${title}</p>
        <p style="margin: 4px 0 0; font-size: 13px; color: #888888;">${digest.readers} reader${digest.readers === 1 ? "" : "s"} · ${digest.opens} open${
          digest.opens === 1 ? "" : "s"
        } · ${formatDuration(digest.seconds)} reading</p>${who}${docs}</div>`;
    })
    .join("");
  const html = shell(
    `<h1 style="margin: 0 0 8px; font-size: 22px; color: #F5F5F5; font-weight: 700;">Yesterday in your data rooms</h1>
      <p style="margin: 0; font-size: 15px; color: #AAAAAA;">Activity on links with the daily digest turned on.</p>
      ${hottestSection(args.hottest ?? [])}
      ${sections}
      ${button(args.activityUrl, "Open activity")}`,
    "You get this because “Daily activity digest” is on for these links. Turn it off on the link to stop.",
  );
  return { subject, html };
}
