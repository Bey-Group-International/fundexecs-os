// lib/integrations/providers/ai-enrichment.ts
// Claude-powered enrichment layer. Augments structured data with fit analysis.
// Uses haiku for speed; all output is JSON-structured (no free-text hallucinations).

import Anthropic from '@anthropic-ai/sdk';
import { anthropicClient } from '@/lib/anthropic-client';
import type { VerifiedCompany, VerifiedInvestor, FitAnalysis, InvestorFitAnalysis } from '../../source-hub-types';

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return anthropicClient(process.env.ANTHROPIC_API_KEY);
}

const MODEL = 'claude-haiku-4-5-20251001';

async function jsonPrompt<T>(systemPrompt: string, userPrompt: string): Promise<T | null> {
  const client = getClient();
  if (!client) return null;

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text')[0]?.text ?? '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return null;
  }
}

interface MandateContext {
  strategy?: string;
  geography?: string;
  targetSize?: string;
  sector?: string;
}

interface InvestorMandateContext {
  strategy?: string;
  targetAUM?: string;
  sector?: string;
}

export async function enrichCompanyFit(
  company: VerifiedCompany,
  mandate: MandateContext
): Promise<FitAnalysis> {
  const fallback: FitAnalysis = {
    fitScore: 50,
    rationale: 'Insufficient data for fit analysis.',
    signals: [],
    firstMove: 'Research further before outreach.',
  };

  const result = await jsonPrompt<FitAnalysis>(
    `You are a private equity deal sourcing analyst. Assess company fit against a mandate.
Return ONLY valid JSON with exactly these fields:
{
  "fitScore": <integer 0-100>,
  "rationale": "<1-2 sentence fit explanation>",
  "signals": ["<signal 1>", "<signal 2>"],
  "firstMove": "<concrete next action>"
}
No markdown. No explanation outside the JSON.`,
    `Company: ${JSON.stringify({
      name: company.name,
      industry: company.industry,
      employees: company.employee_range ?? company.employee_count,
      revenue: company.revenue_range,
      stage: company.funding_stage,
      location: company.headquarters,
      description: company.description,
    })}
Mandate: ${JSON.stringify(mandate)}`
  );

  return result ?? fallback;
}

export async function enrichInvestorProfile(
  investor: VerifiedInvestor,
  mandate: InvestorMandateContext
): Promise<InvestorFitAnalysis> {
  const fallback: InvestorFitAnalysis = {
    fitScore: 50,
    rationale: 'Insufficient data for investor fit analysis.',
    suggestedApproach: 'Request introductory meeting.',
  };

  const result = await jsonPrompt<InvestorFitAnalysis>(
    `You are a fund placement agent assessing LP/investor fit.
Return ONLY valid JSON with exactly these fields:
{
  "fitScore": <integer 0-100>,
  "rationale": "<1-2 sentence fit explanation>",
  "suggestedApproach": "<concrete first outreach action>"
}
No markdown. No explanation outside the JSON.`,
    `Investor: ${JSON.stringify({
      name: investor.name,
      firm: investor.firm,
      type: investor.type,
      aum: investor.aum_range,
      strategy: investor.strategy,
      geography: investor.geography,
    })}
Fund mandate: ${JSON.stringify(mandate)}`
  );

  return result ?? fallback;
}

export async function classifyEntity(raw: string): Promise<{
  kind: 'company' | 'investor' | 'person' | 'fund';
  extractedFields: Record<string, unknown>;
  confidence: number;
}> {
  const fallback = {
    kind: 'company' as const,
    extractedFields: {},
    confidence: 0.3,
  };

  const result = await jsonPrompt<{
    kind: 'company' | 'investor' | 'person' | 'fund';
    extractedFields: Record<string, unknown>;
    confidence: number;
  }>(
    `You are an entity classifier for a finance OS. Given raw text, extract structured fields.
Return ONLY valid JSON:
{
  "kind": "company" | "investor" | "person" | "fund",
  "extractedFields": { <relevant fields> },
  "confidence": <float 0-1>
}`,
    `Entity text: ${raw}`
  );

  return result ?? fallback;
}
