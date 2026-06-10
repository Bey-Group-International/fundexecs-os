import 'server-only';
import { ANALYST_SPECS, personaFor, type AnalystAgent } from './config';

/**
 * Prompt construction for the Meeting Copilot agents. The shared framing is
 * kept in a stable, cacheable system block; the volatile per-run context
 * (the transcript) goes in the user turn so prompt caching stays valid across
 * runs on the same model.
 */

/** Shared institutional framing — stable across agents, marked cacheable. */
export const SHARED_SYSTEM = `You are a member of Earn's fifteen-strong AI executive team inside FundExecs OS, running institutional-grade meeting intelligence. You are analysing a meeting transcript for a private-market fund manager.

Voice: institutional, declarative, operator-grade. Sentence case. Calm authority, no hype, no emoji. Be specific and evidence-driven.

Ground every claim in the provided transcript. Quote the relevant speaker turns that support your finding. If the transcript does not cover something material to your mandate, say so plainly — do not invent facts.

Output ONLY a single JSON object, no prose before or after, no markdown code fences. The JSON must match exactly this shape:
{
  "score": <integer 0-100>,
  "summary": <one or two sentence headline judgment>,
  "detail": <a few short paragraphs of reasoning grounded in the transcript>,
  "citations": [ { "quote": <short verbatim quote from the transcript>, "speaker": <speaker name or role if identifiable> } ]
}

Scoring: 0 means disqualifying or none detected, 50 is mixed/uncertain, 100 is the strongest possible signal for your mandate. Only cite text that appears in the provided transcript.`;

/** Build the agent-specific system instruction (persona + mandate). */
export function analystSystem(agent: AnalystAgent): string {
  const spec = ANALYST_SPECS[agent];
  const persona = personaFor(spec.slug);
  return `Your role on this committee: ${spec.label}. You are speaking as ${persona.name}, ${persona.position}.

Your mandate: ${spec.mandate}`;
}

/** The analyst user turn: transcript plus a directive to produce the finding. */
export function analystUserTurn(agent: AnalystAgent, transcript: string): string {
  const spec = ANALYST_SPECS[agent];
  return `Meeting transcript:\n\n${transcript}\n\nProduce your ${spec.label} finding as the JSON object specified.`;
}

/** Synthesis system framing (Earn, the COO, delivering the final brief). */
export function synthesisSystem(): string {
  const persona = personaFor('earnest-fundmaker');
  return `${SHARED_SYSTEM}

Your role on this committee: Synthesis — the final operator brief. You are speaking as ${persona.name}, ${persona.position}, Earn. The three analytical agents have each filed a finding. Your job is the one that justifies the work: weigh them into a clear, operator-ready meeting debrief.

Override the analyst output shape. Output ONLY a single JSON object, no prose, no code fences, matching exactly:
{
  "commitment_probability": <integer 0-100 — your weighted judgment of how likely this counterparty commits; factor all three lanes>,
  "sentiment": <one of "positive" | "neutral" | "negative" — the dominant emotional register of the meeting>,
  "summary": <one concise paragraph: what happened in this meeting, how it went, and the single most important thing to do next>,
  "follow_up_draft": <two short email paragraphs, ready to send, that the operator can use as a follow-up to this meeting>,
  "top_objections": [ <the highest-priority unresolved objections, each a short string> ],
  "next_actions": [ <the highest-priority next steps, each a short string with an implied owner> ]
}

Commitment probability is your integrated assessment: a single disengaged signal or hard objection can cap it. Be candid; an LP or operator is acting on this.`;
}

/** Shape of one analytical finding fed to Synthesis. */
export interface FindingForSynthesis {
  agent: string;
  label: string;
  score: number | null;
  summary: string;
  detail: string | null;
}

/** The synthesis user turn: the three findings (not the raw transcript). */
export function synthesisUserTurn(findings: FindingForSynthesis[]): string {
  const block = findings
    .map((f) =>
      `### ${f.label} (${f.agent}) — score ${f.score ?? 'n/a'}/100\n${f.summary}\n\n${f.detail ?? ''}`.trim()
    )
    .join('\n\n');
  return `The three analytical findings from your committee:\n\n${block}\n\nProduce your synthesis brief as the JSON object specified.`;
}
