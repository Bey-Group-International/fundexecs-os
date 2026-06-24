// lib/verification-engine.ts
// Core verification layer. Wraps any data fetch and enforces the VerifiedResult envelope.
// No raw data escapes — every result carries source, latency, and confidence metadata.

import type { VerifiedResult, DataSource } from './source-hub-types';

export interface FetchSpec<T> {
  provider: string;
  endpoint: string;
  fetch: () => Promise<T>;
  // Returns false if the result fails schema/sanity checks
  validate: (data: T) => boolean;
  // Optional secondary source for cross-validation
  crossCheck?: () => Promise<T | null>;
  // Returns 0–1 confidence score based on data completeness
  confidenceScore?: (data: T) => number;
}

export async function verifiedFetch<T>(spec: FetchSpec<T>): Promise<VerifiedResult<T>> {
  const startMs = Date.now();
  const retrievedAt = new Date().toISOString();

  try {
    const data = await spec.fetch();
    const latencyMs = Date.now() - startMs;

    const isValid = spec.validate(data);
    if (!isValid) {
      const source: DataSource = {
        provider: spec.provider,
        endpoint: spec.endpoint,
        latency_ms: latencyMs,
        verified: false,
        retrieved_at: retrievedAt,
      };
      return {
        status: 'warning',
        verified: false,
        confidence: 0.3,
        timestamp: new Date().toISOString(),
        sources: [source],
        data,
        errors: ['Data failed schema validation'],
      };
    }

    let confidence = spec.confidenceScore ? spec.confidenceScore(data) : 0.7;
    let crossChecked = false;

    if (spec.crossCheck) {
      try {
        const secondary = await spec.crossCheck();
        if (secondary !== null) {
          crossChecked = true;
          confidence = Math.min(1.0, confidence + 0.15);
        }
      } catch {
        // Cross-check failure is non-fatal — primary data still valid
      }
    }

    const source: DataSource = {
      provider: spec.provider,
      endpoint: spec.endpoint,
      latency_ms: latencyMs,
      verified: true,
      retrieved_at: retrievedAt,
    };

    return {
      status: 'success',
      verified: true,
      confidence: parseFloat(confidence.toFixed(2)),
      timestamp: new Date().toISOString(),
      sources: [source],
      data,
      ...(crossChecked ? {} : {}),
    };
  } catch (err) {
    const latencyMs = Date.now() - startMs;
    const error = err instanceof Error ? err.message : String(err);
    const source: DataSource = {
      provider: spec.provider,
      endpoint: spec.endpoint,
      latency_ms: latencyMs,
      verified: false,
      retrieved_at: retrievedAt,
    };
    return {
      status: 'failed',
      verified: false,
      confidence: 0,
      timestamp: new Date().toISOString(),
      sources: [source],
      data: (Array.isArray((null as unknown)) ? [] : null) as T,
      errors: [error],
    };
  }
}

export function validateRequiredFields(
  obj: Record<string, unknown>,
  required: string[]
): boolean {
  return required.every(
    (field) => obj[field] !== undefined && obj[field] !== null && obj[field] !== ''
  );
}

interface ConfidenceFactors {
  hasEmail?: boolean;
  hasLinkedIn?: boolean;
  hasPhone?: boolean;
  hasRevenue?: boolean;
  hasEmployees?: boolean;
  crossChecked?: boolean;
  hasName?: boolean;
}

export function scoreConfidence(factors: ConfidenceFactors): number {
  let score = 0.3; // base
  if (factors.hasName) score += 0.1;
  if (factors.hasEmail) score += 0.2;
  if (factors.hasLinkedIn) score += 0.15;
  if (factors.hasPhone) score += 0.1;
  if (factors.hasRevenue) score += 0.1;
  if (factors.hasEmployees) score += 0.05;
  if (factors.crossChecked) score += 0.1;
  return parseFloat(Math.min(1.0, score).toFixed(2));
}

// Build a failed result without making an actual fetch — useful for missing-key cases
export function failedResult<T>(
  provider: string,
  endpoint: string,
  errors: string[],
  emptyData: T
): VerifiedResult<T> {
  return {
    status: 'failed',
    verified: false,
    confidence: 0,
    timestamp: new Date().toISOString(),
    sources: [
      {
        provider,
        endpoint,
        latency_ms: 0,
        verified: false,
        retrieved_at: new Date().toISOString(),
      },
    ],
    data: emptyData,
    errors,
  };
}
