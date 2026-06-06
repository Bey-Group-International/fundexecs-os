import 'server-only';
import { ANALYST_SPECS, personaFor, type AnalystAgent } from './config';

/**
 * Prompt construction for the diligence agents. The shared framing is kept in
 * a stable, cacheable system block; the volatile per-run context (retrieved
 * chunks, prior findings) goes in the user turn so prompt caching stays valid.
 */

/** Shared institutional framing — stable across agents, marked cacheable. */
export const SHARED_SYSTEM = `You are a member of Earn's fifteen-strong AI executive team inside FundExecs OS, running institutional-grade investment diligence. You are doing investment-committee work for a private-market fund evaluating an opportunity.

Voice: institutional, declarative, operator-grade. Sentence case. Calm authority, no hype, no emoji. Be specific and evidence-driven.

Ground every claim in the provided document context. Cite the exact documents you rely on. If the materials do not cover something material to your mandate, say so plainly and treat the gap as a diligence finding — do not invent facts.

Output ONLY a single JSON object, no prose before or after, no markdown code fences. The JSON must match exactly this shape:
{
  "score": <integer 0-100>,
  "summary": <one or two sentence headline judgment>,
  "detail": <a few short paragraphs of reasoning grounded in the evidence>,
  "citations": [ { "document_id": <string>, "file_name": <string>, "quote": <short verbatim quote from the context> } ]
}

Scoring: 0 means disqualifying, 50 is mixed/uncertain, 100 is institutionally compelling. Only cite documents that appear in the provided context.`;

/** Build the agent-specific system instruction (persona + mandate). */
export function analystSystem(agent: AnalystAgent): string {
  const spec = ANALYST_SPECS[agent];
  const persona = personaFor(spec.slug);
  return `Your role on this committee: ${spec.label}. You are speaking as ${persona.name}, ${persona.position}.

Your mandate: ${spec.mandate}`;
}

/** Format retrieved chunks into a cited context block for the user turn. */
export interface RetrievedChunk {
  document_id: string;
  file_name: string;
  content: string;
}

export function contextBlock(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return 'No document context was retrieved for your query. Treat the absence of source material as a material diligence gap and score accordingly.';
  }
  return chunks
    .map(
      (c, i) => `[${i + 1}] document_id=${c.document_id} file_name="${c.file_name}"\n${c.content}`
    )
    .join('\n\n');
}

/** The analyst user turn: the cited context plus a directive to produce the finding. */
export function analystUserTurn(agent: AnalystAgent, chunks: RetrievedChunk[]): string {
  const spec = ANALYST_SPECS[agent];
  return `Document context for your ${spec.label} review:\n\n${contextBlock(chunks)}\n\nProduce your ${spec.label} finding as the JSON object specified.`;
}

/** Synthesis system framing (Earn, the COO, delivering final judgment). */
export function synthesisSystem(): string {
  const persona = personaFor('earnest-fundmaker');
  return `${SHARED_SYSTEM}

Your role on this committee: Synthesis — the final judgment. You are speaking as ${persona.name}, ${persona.position}, Earn. The six analytical agents have each filed a finding. Your job is the one that justifies the work: weigh them into an institutional-grade investment-committee memo.

Override the analyst output shape. Output ONLY a single JSON object, no prose, no code fences, matching exactly:
{
  "conviction": <integer 0-100>,
  "memo": <an IC-grade memo: thesis, what the evidence supports, what it does not, and the case for/against — a few tight paragraphs>,
  "recommendation": <one of "pursue" | "pass" | "more_diligence", followed by a one-line rationale>,
  "followUpQuestions": [ <the highest-leverage questions to resolve before committing> ]
}

Conviction is your weighted judgment across all six lanes, not an average — a single disqualifying red flag can cap it. Be candid; an LP is reading this.`;
}

/** The synthesis user turn: the six findings (not the raw docs). */
export interface FindingForSynthesis {
  agent: string;
  label: string;
  score: number | null;
  summary: string;
  detail: string | null;
}

export function synthesisUserTurn(findings: FindingForSynthesis[]): string {
  const block = findings
    .map((f) =>
      `### ${f.label} (${f.agent}) — score ${f.score ?? 'n/a'}/100\n${f.summary}\n\n${f.detail ?? ''}`.trim()
    )
    .join('\n\n');
  return `The six analytical findings from your committee:\n\n${block}\n\nProduce your synthesis as the JSON object specified.`;
}
