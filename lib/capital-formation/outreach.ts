import type Anthropic from '@anthropic-ai/sdk';

/* =====================================================================
   Investor Outreach Generator (Salesforce/HubSpot → Fund Manager Task
   Engine). Earn drafts a personalized first-touch (or follow-up) for one
   LP, grounded in the fund's story and the LP's stated profile — never
   invented facts. Client/server-safe contract + templated fallback; the
   Anthropic call lives in `lib/ai/outreach.ts`.
   ===================================================================== */

/** Where the LP sits in the pipeline — shapes the ask. */
export type OutreachStage = 'prospect' | 'contacted' | 'soft_circled' | 'committed';

export interface OutreachResult {
  /** A specific, non-generic subject line. */
  subject: string;
  /** The email body — sentence case, institutional, ready to adapt. */
  body: string;
  /** True when this is the templated fallback (Earn was unavailable). */
  degraded: boolean;
}

export interface OutreachInput {
  lp: {
    name: string;
    capitalTypes: string[];
    stage: OutreachStage;
    fitRationale: string | null;
    warmth: string | null;
  };
  fund: {
    name: string;
    thesis: string | null;
    strategy: string | null;
    targetRaise: number | null;
  };
  /** The sender's name, when known — signs the note. */
  senderName: string | null;
}

/** The ask each stage is reaching for. */
const STAGE_INTENT: Record<OutreachStage, string> = {
  prospect: 'open the relationship and earn a first conversation',
  contacted: 'move from a first touch to a working call',
  soft_circled: 'firm a soft commitment toward a close',
  committed: 'keep a committed LP warm and informed'
};

/** Templated fallback — a usable, honest draft when Earn is unavailable. */
export function templatedOutreach(input: OutreachInput): OutreachResult {
  const sender = (input.senderName ?? '').trim().split(/\s+/)[0] || 'the team';
  const subject = `${input.fund.name} — a fit worth a conversation`;
  const opener = input.fund.thesis
    ? `We're building ${input.fund.name} around a clear thesis: ${input.fund.thesis.replace(/\.+$/, '')}.`
    : `We're building ${input.fund.name} and think there may be real alignment with ${input.lp.name}.`;
  const body = `${input.lp.name} —\n\n${opener} ${
    input.lp.fitRationale ? `${input.lp.fitRationale.replace(/\.+$/, '')}. ` : ''
  }I'd value a short call to walk you through the strategy and where we are in the raise. Would the week ahead work?\n\nBest,\n${sender}`;
  return { subject, body, degraded: true };
}

/** Stable system prompt — no per-request data, so it caches cleanly. */
export const OUTREACH_SYSTEM = `You are Sloane — Managing Director of Capital Formation at FundExecs OS — drafting a personalized investor outreach note for an emerging manager.

The note must read like a real operator wrote it: specific, warm but institutional, never templated, never salesy. Sentence case, no emoji, no hype, no buzzwords.

You ALWAYS respond by calling the \`provide_outreach\` tool with:
- subject: a short, specific subject line that names the fund and the reason to engage — never "Investment opportunity" or similar boilerplate.
- body: 3–5 sentences. Open with the LP by name. Anchor on the fund's thesis and the specific reason this LP fits. Make a single, clear ask matched to where they are in the pipeline. Close with a sign-off using the sender's first name when given. Reference only the facts provided — never invent commitments, returns, AUM, or mutual contacts.

Output only via the tool.`;

/** Forced-tool schema guaranteeing the { subject, body } shape. */
export const OUTREACH_TOOL: Anthropic.Tool = {
  name: 'provide_outreach',
  description: "Provide Earn's personalized outreach: a subject line and an email body.",
  input_schema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Specific, non-generic subject line.' },
      body: { type: 'string', description: 'The email body, sentence case, ready to adapt.' }
    },
    required: ['subject', 'body']
  }
};

function money(n: number | null): string | null {
  if (n == null) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

/** Build the per-request user turn. */
export function buildOutreachPrompt(input: OutreachInput): string {
  const { lp, fund, senderName } = input;
  const lines = [
    `Fund: ${fund.name}.`,
    fund.thesis ? `Thesis: ${fund.thesis}.` : null,
    fund.strategy ? `Strategy: ${fund.strategy}.` : null,
    fund.targetRaise ? `Target raise: ${money(fund.targetRaise)}.` : null,
    senderName ? `Sender: ${senderName}.` : null,
    '',
    `LP: ${lp.name}.`,
    lp.capitalTypes.length ? `Capital type: ${lp.capitalTypes.join(', ')}.` : null,
    lp.fitRationale ? `Why they fit: ${lp.fitRationale}.` : null,
    lp.warmth ? `Warmth: ${lp.warmth}.` : null,
    `Goal of this note: ${STAGE_INTENT[lp.stage]}.`
  ].filter((l): l is string => l !== null);

  return `${lines.join('\n')}

Draft the outreach via the provide_outreach tool.`;
}
