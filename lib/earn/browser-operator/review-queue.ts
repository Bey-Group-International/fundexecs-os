// lib/earn/browser-operator/review-queue.ts
//
// The review-before-save gate, as pure data helpers. Everything Earn extracts
// becomes a review record the operator works through field-by-field. Nothing is
// saved into the system until fields are approved here.

import type { BrowserDataSource, ExtractedDataPoint } from "./types";

/**
 * Below this confidence, or when a data point is flagged
 * `requires_user_confirmation`, a field blocks silent save and must be
 * explicitly confirmed by the operator.
 */
export const LOW_CONFIDENCE_THRESHOLD = 60;

export type ReviewDecision = "pending" | "approved" | "rejected";

export interface ReviewField {
  field_name: string;
  extracted_value: string;
  source_type: BrowserDataSource;
  source_url?: string;
  confidence_score: number;
  evidence_snippet?: string;
  requires_user_confirmation: boolean;
  /** True when confidence/flags mean this field must be confirmed to save. */
  low_confidence: boolean;
  decision: ReviewDecision;
}

export interface ReviewSummary {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  low_confidence: number;
  /** True when at least one field still requires the operator's confirmation. */
  needs_confirmation: boolean;
  /** True only when every field has an approve/reject decision. */
  fully_decided: boolean;
}

export interface ReviewRecord {
  fields: ReviewField[];
  summary: ReviewSummary;
}

/** Whether a single data point is "blocking" (low confidence or flagged). */
export function isBlocking(
  point: Pick<ExtractedDataPoint, "confidence_score" | "requires_user_confirmation">,
  threshold = LOW_CONFIDENCE_THRESHOLD,
): boolean {
  return point.requires_user_confirmation || point.confidence_score < threshold;
}

/**
 * The subset of extracted points that block a silent save — low confidence or
 * explicitly flagged for confirmation.
 */
export function blockingLowConfidence(
  points: ExtractedDataPoint[],
  threshold = LOW_CONFIDENCE_THRESHOLD,
): ExtractedDataPoint[] {
  return points.filter((p) => isBlocking(p, threshold));
}

function toField(point: ExtractedDataPoint, threshold: number): ReviewField {
  return {
    field_name: point.field_name,
    extracted_value: point.extracted_value,
    source_type: point.source_type,
    source_url: point.source_url,
    confidence_score: point.confidence_score,
    evidence_snippet: point.evidence_snippet,
    requires_user_confirmation: point.requires_user_confirmation,
    low_confidence: isBlocking(point, threshold),
    decision: "pending",
  };
}

/** Compute the roll-up summary for a set of review fields. */
export function reviewSummary(fields: ReviewField[]): ReviewSummary {
  const approved = fields.filter((f) => f.decision === "approved").length;
  const rejected = fields.filter((f) => f.decision === "rejected").length;
  const pending = fields.filter((f) => f.decision === "pending").length;
  const low = fields.filter((f) => f.low_confidence).length;
  // A field still needs confirmation if it is low-confidence and not yet decided.
  const needs = fields.some((f) => f.low_confidence && f.decision === "pending");
  return {
    total: fields.length,
    approved,
    rejected,
    pending,
    low_confidence: low,
    needs_confirmation: needs,
    fully_decided: pending === 0 && fields.length > 0,
  };
}

/** Turn extracted data points into a fresh (all-pending) review record. */
export function buildReviewRecord(
  points: ExtractedDataPoint[],
  threshold = LOW_CONFIDENCE_THRESHOLD,
): ReviewRecord {
  const fields = points.map((p) => toField(p, threshold));
  return { fields, summary: reviewSummary(fields) };
}

/**
 * Apply an approve/reject decision to one field, returning a new record (pure —
 * no mutation of the input).
 */
export function applyDecision(
  record: ReviewRecord,
  fieldName: string,
  decision: ReviewDecision,
): ReviewRecord {
  const fields = record.fields.map((f) =>
    f.field_name === fieldName ? { ...f, decision } : f,
  );
  return { fields, summary: reviewSummary(fields) };
}

/**
 * The fields the operator approved — the only data that may be saved into the
 * system once save approval is granted.
 */
export function approvedFields(record: ReviewRecord): ReviewField[] {
  return record.fields.filter((f) => f.decision === "approved");
}

/**
 * Whether a save may proceed: at least one approved field, and no low-confidence
 * field left un-decided.
 */
export function canSubmitForSave(record: ReviewRecord): boolean {
  return (
    approvedFields(record).length > 0 && !record.summary.needs_confirmation
  );
}
