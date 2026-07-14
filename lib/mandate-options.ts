// lib/mandate-options.ts
// The editable action catalog for the mandate editor — the single list of
// Tier-2 ActionKinds an operator may pre-authorize, with operator-facing labels
// and one-line descriptions. Tier 1 is always free (no need to authorize) and
// Tier 3 is never delegable, so neither appears here.
//
// This module is pure (no DB, no I/O, no React) so it can be imported by the
// RSC page, the "use server" action file, and the client editor alike, and is
// unit-testable in isolation. The catalog is filtered through the gate layer's
// `tierForAction`, so it can never drift out of sync with `lib/gates.ts`: if a
// kind below were ever reclassified, it would simply fall out of the catalog.
import { tierForAction, type ActionKind, type BlastRadius } from "@/lib/gates";

export interface MandateActionOption {
  kind: ActionKind;
  label: string;
  description: string;
}

// The toggleable Tier-2 actions. Order is presentation order in the editor.
// Filtered to Tier 2 defensively so a misclassified entry never leaks through.
export const MANDATE_ACTION_OPTIONS: MandateActionOption[] = (
  [
    {
      kind: "send_outreach",
      label: "Send outreach",
      description: "Send outreach to a prospect.",
    },
    {
      kind: "send_intro_request",
      label: "Request warm intro",
      description: "Ask a mutual connection for a warm introduction.",
    },
    {
      kind: "share_materials",
      label: "Share materials",
      description: "Send a deck, memo, or data room link to a counterparty.",
    },
    {
      kind: "send_diligence_request",
      label: "Send diligence request",
      description: "Request diligence documents or answers from a counterparty.",
    },
    {
      kind: "distribute_report",
      label: "Distribute report",
      description: "Send a report or update out to LPs or stakeholders.",
    },
    {
      kind: "send_reply",
      label: "Reply in inbox",
      description: "Send a reply to a counterparty from a unified-inbox thread.",
    },
    {
      kind: "propose_meeting",
      label: "Propose a meeting",
      description: "Offer times or a booking link to schedule from an inbox thread.",
    },
    {
      kind: "confirm_booking",
      label: "Confirm a booking",
      description: "Confirm a proposed meeting time with the counterparty.",
    },
  ] satisfies MandateActionOption[]
).filter((o) => tierForAction(o.kind) === 2);

// The set of valid, toggleable Tier-2 kinds, derived from the catalog.
const TIER_2_KINDS = new Set<ActionKind>(MANDATE_ACTION_OPTIONS.map((o) => o.kind));

/**
 * True when `kind` is a known, toggleable Tier-2 action. Narrows an arbitrary
 * string to `ActionKind` for callers handling untrusted form input.
 */
export function isMandateActionKind(kind: string): kind is ActionKind {
  return TIER_2_KINDS.has(kind as ActionKind);
}

/**
 * Sanitize a submitted list of action identifiers down to valid Tier-2 kinds:
 * drop anything Tier-1, Tier-3, or unknown, and de-duplicate while preserving
 * first-seen order. The result is always safe to persist as a mandate's
 * `auto_approve` — the gate layer would ignore stray entries anyway, but we keep
 * the stored row clean.
 */
export function sanitizeMandateActions(submitted: readonly string[]): ActionKind[] {
  const seen = new Set<ActionKind>();
  const result: ActionKind[] = [];
  for (const raw of submitted) {
    if (isMandateActionKind(raw) && !seen.has(raw)) {
      seen.add(raw);
      result.push(raw);
    }
  }
  return result;
}

// Guardrails and forbidden domains are entered as free text, one per line. Cap
// the per-entry length and the total count so a paste can't bloat the row or the
// context we inject into Earn.
const MAX_GUARDRAIL_LEN = 240;
const MAX_GUARDRAILS = 25;
const MAX_DOMAINS = 50;

/**
 * Turn a newline-delimited block of guardrail text into a clean, deduplicated
 * list of `{ rule }` objects for the `guardrails` jsonb column: trim each line,
 * drop blanks, truncate to `MAX_GUARDRAIL_LEN`, and cap at `MAX_GUARDRAILS`.
 */
export function sanitizeGuardrails(raw: string): Array<{ rule: string }> {
  const seen = new Set<string>();
  const out: Array<{ rule: string }> = [];
  for (const line of raw.split(/\r?\n/)) {
    const rule = line.trim().slice(0, MAX_GUARDRAIL_LEN);
    if (!rule || seen.has(rule)) continue;
    seen.add(rule);
    out.push({ rule });
    if (out.length >= MAX_GUARDRAILS) break;
  }
  return out;
}

// Reduce a newline/comma-delimited block of domains to a clean, lowercased,
// deduplicated list (protocol/www/path stripped), capped at `MAX_DOMAINS`.
function sanitizeForbiddenDomains(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(/[\s,]+/)) {
    const d = token
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
    if (out.length >= MAX_DOMAINS) break;
  }
  return out;
}

// Coerce a submitted numeric field to a non-negative integer, or undefined when
// blank/garbage (an absent limit is not a constraint).
function positiveIntOrUndefined(raw: unknown): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.trunc(n);
}

/**
 * Build a structured `BlastRadius` from the editor's raw form fields. Blank or
 * invalid fields are simply omitted, so an empty form yields an empty (all-limits-
 * absent) blast radius rather than spurious zero-ceilings.
 */
export function parseBlastRadiusForm(fields: {
  maxOutreachPerDay?: unknown;
  maxDollarPerAction?: unknown;
  forbiddenDomains?: string;
}): BlastRadius {
  const br: BlastRadius = {};
  const outreach = positiveIntOrUndefined(fields.maxOutreachPerDay);
  if (outreach != null) br.maxOutreachPerDay = outreach;
  const dollar = positiveIntOrUndefined(fields.maxDollarPerAction);
  if (dollar != null) br.maxDollarPerAction = dollar;
  const domains = sanitizeForbiddenDomains(fields.forbiddenDomains ?? "");
  if (domains.length) br.forbiddenDomains = domains;
  return br;
}
