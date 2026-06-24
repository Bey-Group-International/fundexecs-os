"use client";
// components/source/VerificationBadge.tsx
// Compact verification status badge surfaced on every live-data entity card.
// Shows: verified indicator, confidence score, source provider, and cache status.

import type { DataSource, CacheMetadata } from "@/lib/source-hub-types";

interface VerificationBadgeProps {
  verified: boolean;
  confidence: number; // 0–1
  sources: DataSource[];
  cache?: CacheMetadata;
  className?: string;
}

function confidenceLabel(c: number): string {
  if (c >= 0.85) return "High";
  if (c >= 0.6) return "Medium";
  if (c >= 0.35) return "Low";
  return "Unverified";
}

function confidenceColor(c: number): string {
  if (c >= 0.85) return "text-emerald-600";
  if (c >= 0.6) return "text-amber-500";
  if (c >= 0.35) return "text-orange-500";
  return "text-red-500";
}

export function VerificationBadge({
  verified,
  confidence,
  sources,
  cache,
  className = "",
}: VerificationBadgeProps) {
  const primarySource = sources[0];
  const pct = Math.round(confidence * 100);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Verified dot */}
      <span
        className={`flex items-center gap-1 text-xs font-medium ${
          verified ? "text-emerald-600" : "text-fg-muted"
        }`}
        title={verified ? "Data verified from live source" : "Unverified — demo or manual data"}
      >
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${
            verified ? "bg-emerald-500" : "bg-neutral-400"
          }`}
        />
        {verified ? "Verified" : "Unverified"}
      </span>

      {/* Confidence */}
      <span
        className={`text-xs font-mono ${confidenceColor(confidence)}`}
        title={`Confidence: ${pct}% (${confidenceLabel(confidence)})`}
      >
        {pct}%
      </span>

      {/* Source provider */}
      {primarySource && (
        <span className="text-xs text-fg-muted" title={`Source: ${primarySource.provider}`}>
          via{" "}
          <span className="font-medium text-fg-secondary capitalize">
            {primarySource.provider}
          </span>
        </span>
      )}

      {/* Cache indicator */}
      {cache?.cache_hit && (
        <span
          className="text-xs text-fg-muted"
          title={`Cached at ${cache.cached_at ? new Date(cache.cached_at).toLocaleString() : "unknown"}`}
        >
          · cached
        </span>
      )}
    </div>
  );
}

// Compact single-line variant for table rows
export function VerificationPill({
  verified,
  confidence,
  provider,
}: {
  verified: boolean;
  confidence: number;
  provider?: string;
}) {
  const pct = Math.round(confidence * 100);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
        verified
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : "bg-neutral-100 text-neutral-500 ring-neutral-200"
      }`}
      title={provider ? `Source: ${provider}` : undefined}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${verified ? "bg-emerald-500" : "bg-neutral-400"}`}
      />
      {verified ? `${pct}%` : "Manual"}
    </span>
  );
}

// Inline source provenance line shown under entity name
export function ProvenanceLine({
  sources,
  timestamp,
}: {
  sources: DataSource[];
  timestamp: string;
}) {
  if (!sources.length) return null;
  const age = Math.round((Date.now() - new Date(timestamp).getTime()) / 60000);
  const ageLabel = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.round(age / 60)}h ago` : `${Math.round(age / 1440)}d ago`;

  return (
    <p className="text-xs text-fg-muted mt-0.5">
      {sources.map((s) => s.provider).join(" · ")} · {ageLabel}
      {sources[0] && (
        <span className="ml-1 text-fg-muted/60">
          ({sources[0].latency_ms}ms)
        </span>
      )}
    </p>
  );
}
