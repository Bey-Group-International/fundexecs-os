"use client";

import { useState } from "react";
import { EarnOrb } from "@/components/copilot/EarnOrb";

export interface CopilotCardAction {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

export interface CopilotCardData {
  stepTitle: string;
  agentLabel?: string;
  status: "running" | "complete" | "error";
  summary: string;
  keyFindings?: string[];
  /** 0–1 confidence score from the routing engine. */
  confidence?: number;
  artifactLabel?: string;
  onOpenArtifact?: () => void;
  nextActions?: CopilotCardAction[];
}

// Derive a confidence tier label + color class from a 0–1 score.
function confidenceTier(score: number): {
  label: string;
  borderClass: string;
  badgeClass: string;
  tooltip: string;
} {
  if (score >= 0.85) {
    return {
      label: "High",
      borderClass: "border-l-status-success",
      badgeClass: "bg-status-success/15 text-status-success",
      tooltip: "Agent has strong grounding from brain KB and record data.",
    };
  }
  if (score >= 0.65) {
    return {
      label: "Medium",
      borderClass: "border-l-status-warning",
      badgeClass: "bg-status-warning/15 text-status-warning",
      tooltip: "Partial grounding — verify key claims before acting.",
    };
  }
  return {
    label: "Low",
    borderClass: "border-l-status-danger",
    badgeClass: "bg-status-danger/15 text-status-danger",
    tooltip: "Limited grounding — treat as a starting point and verify.",
  };
}

const STATUS_LABEL: Record<CopilotCardData["status"], string> = {
  running: "Running",
  complete: "Complete",
  error: "Error",
};

const STATUS_CLASS: Record<CopilotCardData["status"], string> = {
  running: "text-status-info",
  complete: "text-status-success",
  error: "text-status-danger",
};

export function CopilotCard({ data }: { data: CopilotCardData }) {
  const [findingsOpen, setFindingsOpen] = useState(false);
  const tier =
    data.confidence !== undefined ? confidenceTier(data.confidence) : null;

  return (
    <div
      className={`rounded-xl border border-line bg-surface-1 overflow-hidden border-l-4 ${
        tier?.borderClass ?? "border-l-line"
      } animate-fade-up`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line/60">
        <div className="flex items-center gap-2 min-w-0">
          <EarnOrb size={20} pulse={data.status === "running"} />
          <span className="text-sm font-medium text-fg-primary truncate">
            {data.stepTitle}
          </span>
          {data.agentLabel ? (
            <span className="shrink-0 rounded border border-line/70 bg-surface-0/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              {data.agentLabel}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {tier ? (
            <span
              title={tier.tooltip}
              className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider cursor-help ${tier.badgeClass}`}
            >
              {tier.label} confidence
            </span>
          ) : null}
          <span
            className={`font-mono text-[10px] uppercase tracking-wider ${STATUS_CLASS[data.status]}`}
          >
            {STATUS_LABEL[data.status]}
          </span>
        </div>
      </div>

      {/* Summary */}
      <div className="px-4 py-3">
        <p className="text-sm text-fg-primary leading-relaxed">{data.summary}</p>
      </div>

      {/* Key Findings */}
      {data.keyFindings && data.keyFindings.length > 0 ? (
        <div className="border-t border-line/60 px-4 py-2">
          <button
            type="button"
            onClick={() => setFindingsOpen((v) => !v)}
            className="flex w-full items-center justify-between py-1 text-xs font-medium text-fg-secondary hover:text-fg-primary transition"
          >
            <span className="uppercase tracking-wider font-mono text-[9px]">
              Key Findings
            </span>
            <span className="font-mono text-fg-muted">{findingsOpen ? "▲" : "▼"}</span>
          </button>
          {findingsOpen ? (
            <ul className="mt-2 mb-1 space-y-1.5">
              {data.keyFindings.slice(0, 5).map((finding, i) => (
                <li key={i} className="flex gap-2 text-sm text-fg-secondary">
                  <span className="text-gold-400 shrink-0">·</span>
                  <span>{finding}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Artifact */}
      {data.artifactLabel ? (
        <div className="border-t border-line/60 px-4 py-2.5 flex items-center gap-3">
          <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
            Artifact
          </span>
          <span className="text-sm text-fg-secondary truncate flex-1">
            {data.artifactLabel}
          </span>
          {data.onOpenArtifact ? (
            <button
              type="button"
              onClick={data.onOpenArtifact}
              className="shrink-0 rounded border border-line px-2.5 py-1 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
            >
              Open
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Low-confidence verify prompt */}
      {tier?.label === "Low" ? (
        <div className="border-t border-status-danger/20 bg-status-danger/5 px-4 py-2.5 flex items-center gap-3">
          <span className="text-xs text-status-danger">
            Limited grounding detected — verify key claims before acting.
          </span>
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent("earn:open-with-context", {
                  detail: {
                    prompt: `Verify the following claim from the step "${data.stepTitle}": ${data.summary}`,
                  },
                }),
              );
            }}
            className="shrink-0 rounded border border-status-danger/30 px-2.5 py-1 text-xs text-status-danger transition hover:bg-status-danger/10"
          >
            Verify this
          </button>
        </div>
      ) : null}

      {/* Next Actions */}
      {data.nextActions && data.nextActions.length > 0 ? (
        <div className="border-t border-line/60 px-4 py-3 flex items-center gap-2 flex-wrap">
          {data.nextActions.slice(0, 3).map((action, i) => (
            <button
              key={i}
              type="button"
              onClick={action.onClick}
              className={
                action.primary
                  ? "rounded-lg bg-gold-500 px-3 py-1.5 text-sm font-medium text-black transition hover:bg-gold-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                  : "rounded-lg border border-line px-3 py-1.5 text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
              }
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
