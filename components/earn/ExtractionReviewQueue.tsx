"use client";

import { useMemo, useState } from "react";
import {
  applyDecision,
  buildReviewRecord,
  canSubmitForSave,
  type ExtractedDataPoint,
  type ReviewRecord,
} from "@/lib/earn/browser-operator";

// ExtractionReviewQueue — the review-before-save gate. Every field Earn
// extracted is shown with its source and confidence; the operator approves,
// rejects, or edits each one. Nothing is saved until the operator says so, and
// low-confidence fields block save until explicitly decided.

type Props = {
  points: ExtractedDataPoint[];
  /**
   * The `earn_review_queue` row id. When provided, the save button hits the
   * approve-extraction route directly — this is where data enters the system.
   */
  reviewId?: string;
  /** Called with the approved fields when the operator is ready to save. */
  onReadyToSave?: (record: ReviewRecord) => void;
  /** Called after a successful save via the approve-extraction route. */
  onSaved?: (result: unknown) => void;
};

export function ExtractionReviewQueue({ points, reviewId, onReadyToSave, onSaved }: Props) {
  const [record, setRecord] = useState<ReviewRecord>(() => buildReviewRecord(points));
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summary = record.summary;
  const readyToSave = useMemo(() => canSubmitForSave(record), [record]);

  function decide(fieldName: string, decision: "approved" | "rejected") {
    setRecord((r) => applyDecision(r, fieldName, decision));
  }

  async function handleSave() {
    if (!reviewId) {
      onReadyToSave?.(record);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const approvedFields = record.fields
        .filter((f) => f.decision === "approved")
        .map((f) => f.field_name);
      const res = await fetch("/api/earn/browser/approve-extraction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId, approvedFields }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Save failed");
        return;
      }
      onSaved?.(json);
    } catch (e) {
      setError((e as Error)?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (points.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface-1 p-5 text-sm text-fg-muted">
        No extracted data yet. When Earn extracts fields, each one appears here
        for your review before anything is saved.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-fg">Review extracted data</h3>
        <span className="font-mono text-[11px] text-fg-muted">
          {summary.approved} approved · {summary.rejected} rejected · {summary.pending} pending
        </span>
      </div>

      {summary.needs_confirmation && (
        <p className="mt-2 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
          Some fields are low-confidence and must be confirmed before you can save.
        </p>
      )}

      <ul className="mt-4 flex flex-col gap-3">
        {record.fields.map((f) => {
          const value = edits[f.field_name] ?? f.extracted_value;
          const decidedClass =
            f.decision === "approved"
              ? "border-status-success/50"
              : f.decision === "rejected"
                ? "border-status-danger/50 opacity-70"
                : "border-line";
          return (
            <li
              key={f.field_name}
              className={`rounded-xl border ${decidedClass} bg-surface-2 p-3`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] uppercase tracking-wide text-fg-muted">
                  {f.field_name}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-accent">{f.source_type}</span>
                  <span
                    className={`font-mono text-[10px] ${
                      f.low_confidence ? "text-status-warning" : "text-fg-muted"
                    }`}
                  >
                    {f.confidence_score}%{f.low_confidence ? " · confirm" : ""}
                  </span>
                </span>
              </div>

              <input
                value={value}
                onChange={(e) =>
                  setEdits((prev) => ({ ...prev, [f.field_name]: e.target.value }))
                }
                className="mt-2 w-full rounded-md border border-line bg-surface-0 px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
              />

              {f.evidence_snippet && (
                <p className="mt-1.5 text-[11px] italic text-fg-muted">“{f.evidence_snippet}”</p>
              )}

              {f.source_url && (
                <a
                  href={f.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 block truncate font-mono text-[10px] text-accent hover:underline"
                  title={f.source_url}
                >
                  {f.source_url}
                </a>
              )}

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => decide(f.field_name, "approved")}
                  className="rounded-md border border-status-success/50 px-2.5 py-1 text-xs text-status-success transition hover:bg-status-success/10"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => decide(f.field_name, "rejected")}
                  className="rounded-md border border-status-danger/50 px-2.5 py-1 text-xs text-status-danger transition hover:bg-status-danger/10"
                >
                  Reject
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {error && (
        <p className="mt-3 rounded-md border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={!readyToSave || saving}
        onClick={handleSave}
        className="mt-4 w-full rounded-md border border-accent/60 bg-accent/10 px-3 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving
          ? "Saving approved fields…"
          : readyToSave
            ? reviewId
              ? "Approve & save reviewed data"
              : "Continue to save approval"
            : "Decide all flagged fields to continue"}
      </button>
    </div>
  );
}
