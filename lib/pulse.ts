// lib/pulse.ts
// Market Pulse — the PURE half (no DB, no key, fully unit-testable).
//
// Once a day Earn searches the live web for deals, investment opportunities,
// and investors that fit the firm's active mandate, and posts each finding as
// a short take with its source. This module holds everything that doesn't touch
// the database or the model: the daily search budget, the prompt, and parsing
// the model's JSON into rows. The sweep itself lives in lib/pulse.server.ts.
import type { InvestmentThesis, PulseItemKind } from "@/lib/supabase/database.types";
import { EntityDedupe, normalizeEntityName } from "@/lib/source-identity";

/** Web searches one org may spend on Pulse in any rolling 24 hours. */
export const PULSE_DAILY_SEARCH_CAP = 5;

/** Flat credits charged up front for a Pulse run (searches are metered on top). */
export const PULSE_RUN_COST = 4;

/** Most findings kept from one run. */
export const PULSE_MAX_ITEMS_PER_RUN = 8;

/** Findings below this fit score are tucked under "Show more" on the Pulse page. */
export const PULSE_SHOW_THRESHOLD = 60;

/** Findings at or above this fit score raise their own Inbox alert after a sweep. */
export const PULSE_ALERT_THRESHOLD = 85;

/** How many findings the daily digest lists. */
export const PULSE_DIGEST_SIZE = 3;

/** Orgs swept per hourly cron pass. One long-run model call per org shares the
 *  cron's 300s envelope with every other sweep, so the hourly cadence spreads
 *  orgs across the day instead. */
export const PULSE_MAX_ORGS_PER_SWEEP = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

const KINDS: readonly PulseItemKind[] = ["deal", "investment", "investor"];

/** Searches still available today, given the searches recorded in the last 24h. */
export function remainingSearches(searchesLast24h: number, cap = PULSE_DAILY_SEARCH_CAP): number {
  const used = Number.isFinite(searchesLast24h) && searchesLast24h > 0 ? Math.floor(searchesLast24h) : 0;
  return Math.max(0, cap - used);
}

/** Whether an org's last sweep is old enough to run the daily sweep again. */
export function sweepIsDue(lastSweepAt: string | null | undefined, now: Date): boolean {
  if (!lastSweepAt) return true;
  const t = Date.parse(lastSweepAt);
  return !Number.isFinite(t) || now.getTime() - t >= DAY_MS;
}

export interface PulseMandate {
  thesis: Pick<
    InvestmentThesis,
    "title" | "summary" | "asset_classes" | "geographies" | "check_size_min" | "check_size_max" | "target_irr" | "target_moic"
  > | null;
  /** Free-text scope from the active delegation mandate, if any. */
  scope: string | null;
}

/** True when there is enough mandate to search against. */
export function hasSearchableMandate(m: PulseMandate): boolean {
  const t = m.thesis;
  return Boolean(
    (t && (t.title?.trim() || t.summary?.trim() || t.asset_classes?.length || t.geographies?.length)) || m.scope?.trim(),
  );
}

function money(n: number | null | undefined): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e9) return `$${+(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${+(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n / 1e3)}K`;
}

/** The mandate as the model sees it. */
export function mandateBrief(m: PulseMandate): string {
  const t = m.thesis;
  const lines: string[] = [];
  if (t?.title?.trim()) lines.push(`Thesis: ${t.title.trim()}`);
  if (t?.summary?.trim()) lines.push(`Summary: ${t.summary.trim().slice(0, 800)}`);
  if (t?.asset_classes?.length) lines.push(`Asset classes: ${t.asset_classes.join(", ")}`);
  if (t?.geographies?.length) lines.push(`Geographies: ${t.geographies.join(", ")}`);
  const lo = money(t?.check_size_min);
  const hi = money(t?.check_size_max);
  if (lo || hi) lines.push(`Check size: ${lo ?? "?"}–${hi ?? "?"}`);
  if (t?.target_irr) lines.push(`Target IRR: ${t.target_irr}%`);
  if (t?.target_moic) lines.push(`Target MOIC: ${t.target_moic}x`);
  if (m.scope?.trim()) lines.push(`Mandate scope: ${m.scope.trim().slice(0, 600)}`);
  return lines.join("\n");
}

export function pulseSystemPrompt(): string {
  return (
    `You are Earn's Market Pulse inside FundExecs OS, scanning the live web for a private-market firm. ` +
    `Use web search to find what is NEW and REAL in the last few weeks that fits the firm's mandate:\n` +
    `- deal: a company, asset, or portfolio that is raising, for sale, or recapitalizing\n` +
    `- investment: a fund, co-investment, secondary, or credit opportunity the firm could deploy into\n` +
    `- investor: an LP, family office, or allocator actively committing to strategies like the firm's\n` +
    `Only report items backed by a specific, current source page. Never invent names, figures, or URLs; skip anything you can't source. ` +
    `Never include email addresses, phone numbers, or LinkedIn URLs.\n` +
    `Return ONLY a JSON array (no prose, no markdown) of objects with keys: ` +
    `kind ("deal" | "investment" | "investor"), entity_name, headline (one line, what happened), ` +
    `take (one or two blunt sentences: is it worth a look and why), why_it_fits (tie it to the mandate), ` +
    `source_url, source_title, fit_score (0-100). Return at most ${PULSE_MAX_ITEMS_PER_RUN} items, best first. ` +
    `Aim for a balanced mix — at least one deal, one investment, and one investor when credible ones exist — rather than all of one kind. ` +
    `Return [] if nothing current fits.`
  );
}

export function pulseUserPrompt(input: {
  mandate: PulseMandate;
  existingNames: string[];
  dismissedHeadlines: string[];
  today: Date;
}): string {
  return (
    `Today is ${input.today.toISOString().slice(0, 10)}.\n\n` +
    `Firm mandate:\n${mandateBrief(input.mandate)}\n\n` +
    (input.existingNames.length
      ? `Already in the firm's pipeline or feed (do not repeat): ${input.existingNames.slice(0, 60).join(", ")}.\n\n`
      : "") +
    (input.dismissedHeadlines.length
      ? `The firm dismissed these as not relevant — avoid similar items:\n${input.dismissedHeadlines
          .slice(0, 15)
          .map((h) => `  - ${h}`)
          .join("\n")}\n\n`
      : "") +
    `Find current deals, investments, and investors that fit. Return the JSON array.`
  );
}

/** Pull the first JSON array out of a model reply (tolerates code fences). */
export function parseJsonArray(text: string): unknown[] | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface PulseFinding {
  kind: PulseItemKind;
  entity_name: string;
  headline: string;
  take: string | null;
  why_it_fits: string | null;
  source_url: string | null;
  source_title: string | null;
  fit_score: number | null;
  dedupe_key: string;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

const CONTACT_LIKE = /[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s().-]{8,}\d|linkedin\.com/i;

function safeUrl(v: unknown): string | null {
  const s = str(v, 500);
  if (!s || !/^https?:\/\//i.test(s) || /linkedin\.com/i.test(s)) return null;
  try {
    return new URL(s).toString();
  } catch {
    return null;
  }
}

/**
 * Validate and dedupe raw model output. Drops anything without a name, a
 * headline, or a source; anything already known to the firm (pipeline, feed,
 * dismissed); and any prose that looks like contact details.
 */
export function normalizeFindings(raw: unknown[], knownNames: Iterable<string>): PulseFinding[] {
  const dedupe = new EntityDedupe(knownNames);
  const out: PulseFinding[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const kind = typeof o.kind === "string" && KINDS.includes(o.kind as PulseItemKind) ? (o.kind as PulseItemKind) : null;
    const entity_name = str(o.entity_name, 160);
    const headline = str(o.headline, 280);
    const source_url = safeUrl(o.source_url);
    if (!kind || !entity_name || !headline || !source_url) continue;
    const take = str(o.take, 600);
    const why_it_fits = str(o.why_it_fits, 600);
    if ([headline, take, why_it_fits].some((t) => t && CONTACT_LIKE.test(t))) continue;
    const dedupe_key = normalizeEntityName(entity_name);
    if (!dedupe_key || !dedupe.add(entity_name)) continue;
    const score = typeof o.fit_score === "number" && Number.isFinite(o.fit_score) ? Math.round(o.fit_score) : null;
    out.push({
      kind,
      entity_name,
      headline,
      take,
      why_it_fits,
      source_url,
      source_title: str(o.source_title, 200),
      fit_score: score === null ? null : Math.min(100, Math.max(0, score)),
      dedupe_key,
    });
    if (out.length >= PULSE_MAX_ITEMS_PER_RUN) break;
  }
  return out;
}

// --- Visibility, digest, and alerts --------------------------------------------

/** Split findings into those shown up front and those tucked under "Show more". */
export function splitByFit<T extends { fit_score: number | null }>(
  items: T[],
  threshold = PULSE_SHOW_THRESHOLD,
): { shown: T[]; more: T[] } {
  const shown: T[] = [];
  const more: T[] = [];
  for (const item of items) (item.fit_score === null || item.fit_score >= threshold ? shown : more).push(item);
  return { shown, more };
}

export interface DigestFinding {
  kind: PulseItemKind;
  entity_name: string;
  headline: string;
  take: string | null;
  fit_score: number | null;
  source_url: string | null;
}

/**
 * After a sweep: findings at or above the alert threshold get their own alert
 * (at most the digest size), and the digest lists the best remaining ones.
 */
export function planNotices<T extends DigestFinding>(
  findings: T[],
): { alerts: T[]; digest: T[] } {
  const ranked = [...findings].sort((a, b) => (b.fit_score ?? -1) - (a.fit_score ?? -1));
  const alerts = ranked.filter((f) => (f.fit_score ?? 0) >= PULSE_ALERT_THRESHOLD).slice(0, PULSE_DIGEST_SIZE);
  const digest = ranked.filter((f) => !alerts.includes(f)).slice(0, PULSE_DIGEST_SIZE);
  return { alerts, digest };
}

const KIND_LABEL: Record<PulseItemKind, string> = { deal: "Deal", investment: "Investment", investor: "Investor" };

function line(f: DigestFinding): string {
  const score = f.fit_score !== null ? ` (fit ${f.fit_score})` : "";
  return `${KIND_LABEL[f.kind]} — ${f.entity_name}${score}: ${f.headline}`;
}

/** Inbox copy for one high-fit finding. */
export function alertCopy(f: DigestFinding): { subject: string; preview: string; body: string } {
  return {
    subject: `High-fit Pulse find: ${f.entity_name}`,
    preview: line(f),
    body:
      `${line(f)}\n\n` +
      (f.take ? `${f.take}\n\n` : "") +
      (f.source_url ? `Source: ${f.source_url}\n\n` : "") +
      `Review it in Market Pulse: /pulse`,
  };
}

/** Inbox copy for the daily digest, or null when there is nothing to list. */
export function digestCopy(
  findings: DigestFinding[],
  totalNew: number,
): { subject: string; preview: string; body: string } | null {
  if (!findings.length) return null;
  const more = totalNew > findings.length ? `\n\n+${totalNew - findings.length} more in Market Pulse: /pulse` : "\n\nOpen Market Pulse: /pulse";
  return {
    subject: `Market Pulse: ${totalNew} new ${totalNew === 1 ? "finding" : "findings"} today`,
    preview: line(findings[0]),
    body: findings.map((f, i) => `${i + 1}. ${line(f)}${f.take ? `\n   ${f.take}` : ""}`).join("\n\n") + more,
  };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Email HTML for the digest (sent only where the org has a mailbox connected). */
export function digestEmailHtml(findings: DigestFinding[], totalNew: number, pulseUrl: string): string {
  const rows = findings
    .map(
      (f) =>
        `<li style="margin:0 0 14px;"><strong style="color:#F5F5F5;">${esc(f.entity_name)}</strong>` +
        ` <span style="color:#888;">· ${KIND_LABEL[f.kind]}${f.fit_score !== null ? ` · fit ${f.fit_score}` : ""}</span>` +
        `<br/><span style="color:#CCCCCC;">${esc(f.headline)}</span>` +
        (f.take ? `<br/><span style="color:#999999;">${esc(f.take)}</span>` : "") +
        `</li>`,
    )
    .join("");
  const href = /^https?:\/\//i.test(pulseUrl) ? pulseUrl : "#";
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8" /></head>` +
    `<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;margin:0;padding:32px 16px;">` +
    `<div style="max-width:560px;margin:0 auto;background:#111;border:1px solid #222;border-radius:12px;padding:28px 24px;">` +
    `<h1 style="margin:0 0 6px;font-size:20px;color:#F5F5F5;">Market Pulse</h1>` +
    `<p style="margin:0 0 18px;font-size:14px;color:#AAAAAA;">${totalNew} new ${totalNew === 1 ? "finding" : "findings"} that fit your mandate.</p>` +
    `<ol style="padding-left:18px;margin:0;font-size:14px;">${rows}</ol>` +
    `<a href="${esc(href)}" style="display:inline-block;margin-top:18px;background:#F59E0B;color:#0a0a0a;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:700;">Open Market Pulse</a>` +
    `</div></body></html>`
  );
}
