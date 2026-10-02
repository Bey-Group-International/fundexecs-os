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
