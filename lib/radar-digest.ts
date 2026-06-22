// lib/radar-digest.ts
// The Act-now Radar digest composer — PURE, deterministic, unit-testable.
//
// Given the Source Radar's ranked RadarItem[] (lib/source-radar.ts) and a
// minimum-score bar, it produces one digest payload rendered for every delivery
// channel at once: a Slack-flavored markdown block, an email subject + HTML/text
// body, and a compact in-app summary. Each row carries the Radar "move" — the
// deep link into the cluster that acts on it — so a digest is never a dead-end
// read: it points the operator straight at the next move.
//
// No DB, no network, no env, no clock surprises: the same items in always yield
// the same payload out. The server-side send (lib/radar-send.ts) handles I/O.
import type { RadarItem } from "@/lib/source-radar";
import { buildTrackingUrl, type DigestTrackParams } from "@/lib/digest-tracking";

// How many items a single digest carries, regardless of how many clear the bar —
// a digest is a short, actionable brief, not a dump of the whole radar.
const DEFAULT_TOP = 5;

/**
 * Implicit-engagement tracking config. When present, Slack/email move links are
 * wrapped to route through /api/digest/track (signed with `secret`) so a click
 * is captured as implicit feedback, and the email body carries an open pixel.
 * Absent → links stay plain deep links (the digest never breaks without it).
 * PURE: building the signed URL is just an HMAC over the params (lib/digest-tracking).
 */
export interface DigestTracking {
  /** Server secret the tracking links are signed with (DIGEST_TRACK_SECRET / CRON_SECRET). */
  secret: string;
  /** The radar_digest_log row id this digest is attributed to. */
  digestLogId: string;
  /** The org the digest belongs to. */
  orgId: string;
}

export interface DigestOptions {
  /** Minimum RadarItem.score to include. Defaults to 60. */
  minScore?: number;
  /** Cap on rows in the digest. Defaults to 5. */
  limit?: number;
  /**
   * Absolute base URL for deep links (e.g. "https://app.fundexecs.com"). When
   * set, relative move hrefs are made absolute so they survive Slack/email.
   */
  baseUrl?: string;
  /** Cadence label for the heading ("daily" | "weekly"). Defaults to "daily". */
  cadence?: "daily" | "weekly";
  /**
   * Optional engagement tracking. When set, the Slack/email channels wrap move
   * links + add an open pixel so the learning loop sees implicit signals. The
   * in-app summary always keeps raw deep links (no tracking needed in-app).
   */
  tracking?: DigestTracking;
  /**
   * Subject-line A/B override. When set, it REPLACES the default email subject
   * (and the Slack header reuses it) so a send can be assigned an experiment
   * variant (lib/digest-experiments.ts). Absent → the default subject is used
   * verbatim, so default compose stays byte-identical. PURE: it's just the
   * chosen string; the composer never derives or randomizes it.
   */
  subject?: string;
}

// One digest row — the slice of a RadarItem a brief needs, plus the resolved
// move link. Kept narrow so the in-app/Slack/email renderers share one shape.
export interface DigestItem {
  name: string;
  score: number;
  signalSummary: string;
  moveLabel: string;
  moveKind: string;
  /** Resolved deep link into the owning cluster, or null for inline moves. */
  moveHref: string | null;
  /** The radar entity this row points at — for engagement attribution. */
  entityId: string | null;
  /** The entity kind, denormalized for engagement attribution. */
  entityKind: string;
}

export interface DigestPayload {
  /** Number of rows in the digest (0 = empty state). */
  count: number;
  /** Slack-flavored markdown (mrkdwn) block, ready for chat.postMessage. */
  slackMarkdown: string;
  /** Email subject line. */
  emailSubject: string;
  /** Email body — HTML and a plain-text fallback. */
  emailBody: { html: string; text: string };
  /** Compact one-line in-app inbox summary (the thread preview). */
  inAppSummary: string;
  /** The resolved top rows, for the in-app message body and the log snapshot. */
  topItems: DigestItem[];
}

// --- Pure helpers -----------------------------------------------------------

function clampMinScore(min: number | undefined): number {
  const n = typeof min === "number" && Number.isFinite(min) ? min : 60;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function resolveHref(href: string | undefined, baseUrl: string | undefined): string | null {
  if (!href) return null;
  if (!baseUrl) return href;
  // Absolute already (http/https) → leave it; otherwise prefix the base.
  if (/^https?:\/\//i.test(href)) return href;
  return `${baseUrl.replace(/\/+$/, "")}${href.startsWith("/") ? "" : "/"}${href}`;
}

/**
 * The link a digest row should point at. With tracking configured AND a real
 * deep link present, return a signed /api/digest/track URL (action=clicked) that
 * records the engagement and redirects to the deep link; otherwise the plain
 * deep link (so the digest never breaks without a secret). Pure.
 */
function trackedHref(
  it: DigestItem,
  opts: DigestOptions,
): string | null {
  const t = opts.tracking;
  if (!t || !t.secret || !it.moveHref) return it.moveHref;
  const params: DigestTrackParams = {
    digestLogId: t.digestLogId,
    orgId: t.orgId,
    entityId: it.entityId,
    entityKind: it.entityKind,
    moveKind: it.moveKind,
    action: "clicked",
    href: it.moveHref,
  };
  return buildTrackingUrl(t.secret, params, opts.baseUrl);
}

/**
 * The 1×1 open-pixel tracking URL for an email body, or null when tracking is
 * not configured. Signed with action=opened (no href). Pure.
 */
export function openPixelUrl(opts: DigestOptions): string | null {
  const t = opts.tracking;
  if (!t || !t.secret) return null;
  const params: DigestTrackParams = {
    digestLogId: t.digestLogId,
    orgId: t.orgId,
    action: "opened",
  };
  return buildTrackingUrl(t.secret, params, opts.baseUrl);
}

/**
 * Filter to items that clear the score bar, rank highest-first (ties broken by
 * name for determinism), take the top N, and resolve each move link. Pure.
 */
export function selectDigestItems(items: RadarItem[], opts: DigestOptions = {}): DigestItem[] {
  const minScore = clampMinScore(opts.minScore);
  const limit = opts.limit && opts.limit > 0 ? Math.floor(opts.limit) : DEFAULT_TOP;
  return items
    .filter((it) => it.score >= minScore)
    .slice()
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((it) => ({
      name: it.name,
      score: it.score,
      signalSummary: it.signalSummary,
      moveLabel: it.move.label,
      moveKind: it.move.kind,
      moveHref: resolveHref(it.move.href, opts.baseUrl),
      entityId: it.entityId,
      entityKind: it.kind,
    }));
}

function cadenceLabel(cadence: DigestOptions["cadence"]): string {
  return cadence === "weekly" ? "Weekly" : "Daily";
}

// HTML-escape for the email body — pure, no DOM.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slackBlock(top: DigestItem[], cadence: string, opts: DigestOptions): string {
  if (top.length === 0) {
    return `*${cadence} Act-now Radar*\nNothing clears the bar right now — the radar is quiet. Scan signals to surface new triggers.`;
  }
  const lines = top.map((it, i) => {
    const href = trackedHref(it, opts);
    const move = href ? `<${href}|${it.moveLabel}>` : it.moveLabel;
    return `${i + 1}. *${it.name}* — score ${it.score} · _${it.signalSummary}_\n   → ${move}`;
  });
  // The header echoes the (possibly A/B-overridden) subject so Slack and email
  // carry the same variant framing; absent an override it's the default header
  // verbatim, keeping default compose byte-identical.
  const header = opts.subject ?? `${cadence} Act-now Radar — top ${top.length}`;
  return [`*${header}*`, ...lines].join("\n");
}

function emailHtml(top: DigestItem[], cadence: string, opts: DigestOptions): string {
  // A 1×1 transparent open pixel — fires the "opened" implicit signal when the
  // email is rendered. Absent when tracking isn't configured.
  const pixel = openPixelUrl(opts);
  const pixelTag = pixel
    ? `<img src="${esc(pixel)}" width="1" height="1" alt="" style="display:none" />`
    : "";
  if (top.length === 0) {
    return `<h2>${cadence} Act-now Radar</h2><p>Nothing clears the bar right now — the radar is quiet.</p>${pixelTag}`;
  }
  const rows = top
    .map((it) => {
      const href = trackedHref(it, opts);
      const move = href
        ? `<a href="${esc(href)}">${esc(it.moveLabel)}</a>`
        : esc(it.moveLabel);
      return (
        `<li><strong>${esc(it.name)}</strong> — score ${it.score}<br/>` +
        `<span>${esc(it.signalSummary)}</span><br/>→ ${move}</li>`
      );
    })
    .join("");
  return `<h2>${cadence} Act-now Radar — top ${top.length}</h2><ol>${rows}</ol>${pixelTag}`;
}

function emailText(top: DigestItem[], cadence: string, opts: DigestOptions): string {
  if (top.length === 0) {
    return `${cadence} Act-now Radar\n\nNothing clears the bar right now — the radar is quiet.`;
  }
  const lines = top.map((it, i) => {
    const href = trackedHref(it, opts);
    const move = href ? `${it.moveLabel} (${href})` : it.moveLabel;
    return `${i + 1}. ${it.name} — score ${it.score}\n   ${it.signalSummary}\n   -> ${move}`;
  });
  return [`${cadence} Act-now Radar — top ${top.length}`, "", ...lines].join("\n");
}

function inAppSummaryLine(top: DigestItem[], cadence: string): string {
  if (top.length === 0) {
    return `${cadence} Act-now Radar: nothing clears the bar right now.`;
  }
  const lead = top[0];
  const more = top.length > 1 ? ` +${top.length - 1} more` : "";
  return `${cadence} Act-now Radar: ${lead.name} (score ${lead.score}) → ${lead.moveLabel}${more}.`;
}

/**
 * Compose the full multi-channel digest payload from a ranked RadarItem[].
 * Deterministic: same items + opts → same payload. The single entry point the
 * send service and tests call.
 */
export function composeDigest(items: RadarItem[], opts: DigestOptions = {}): DigestPayload {
  const cadence = cadenceLabel(opts.cadence);
  const top = selectDigestItems(items, opts);
  const defaultSubject =
    top.length === 0
      ? `${cadence} Act-now Radar — quiet today`
      : `${cadence} Act-now Radar — ${top.length} to act on (top: ${top[0].name})`;
  // An A/B variant may override the subject; absent an override the default is
  // used verbatim so default compose stays byte-identical (guarded by a test).
  const subject = opts.subject ?? defaultSubject;

  return {
    count: top.length,
    slackMarkdown: slackBlock(top, cadence, opts),
    emailSubject: subject,
    emailBody: { html: emailHtml(top, cadence, opts), text: emailText(top, cadence, opts) },
    inAppSummary: inAppSummaryLine(top, cadence),
    topItems: top,
  };
}
