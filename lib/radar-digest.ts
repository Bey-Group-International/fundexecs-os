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

// How many items a single digest carries, regardless of how many clear the bar —
// a digest is a short, actionable brief, not a dump of the whole radar.
const DEFAULT_TOP = 5;

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

function slackBlock(top: DigestItem[], cadence: string): string {
  if (top.length === 0) {
    return `*${cadence} Act-now Radar*\nNothing clears the bar right now — the radar is quiet. Scan signals to surface new triggers.`;
  }
  const lines = top.map((it, i) => {
    const move = it.moveHref ? `<${it.moveHref}|${it.moveLabel}>` : it.moveLabel;
    return `${i + 1}. *${it.name}* — score ${it.score} · _${it.signalSummary}_\n   → ${move}`;
  });
  return [`*${cadence} Act-now Radar — top ${top.length}*`, ...lines].join("\n");
}

function emailHtml(top: DigestItem[], cadence: string): string {
  if (top.length === 0) {
    return `<h2>${cadence} Act-now Radar</h2><p>Nothing clears the bar right now — the radar is quiet.</p>`;
  }
  const rows = top
    .map((it) => {
      const move = it.moveHref
        ? `<a href="${esc(it.moveHref)}">${esc(it.moveLabel)}</a>`
        : esc(it.moveLabel);
      return (
        `<li><strong>${esc(it.name)}</strong> — score ${it.score}<br/>` +
        `<span>${esc(it.signalSummary)}</span><br/>→ ${move}</li>`
      );
    })
    .join("");
  return `<h2>${cadence} Act-now Radar — top ${top.length}</h2><ol>${rows}</ol>`;
}

function emailText(top: DigestItem[], cadence: string): string {
  if (top.length === 0) {
    return `${cadence} Act-now Radar\n\nNothing clears the bar right now — the radar is quiet.`;
  }
  const lines = top.map((it, i) => {
    const move = it.moveHref ? `${it.moveLabel} (${it.moveHref})` : it.moveLabel;
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
  const subject =
    top.length === 0
      ? `${cadence} Act-now Radar — quiet today`
      : `${cadence} Act-now Radar — ${top.length} to act on (top: ${top[0].name})`;

  return {
    count: top.length,
    slackMarkdown: slackBlock(top, cadence),
    emailSubject: subject,
    emailBody: { html: emailHtml(top, cadence), text: emailText(top, cadence) },
    inAppSummary: inAppSummaryLine(top, cadence),
    topItems: top,
  };
}
