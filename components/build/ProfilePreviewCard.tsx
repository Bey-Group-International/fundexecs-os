"use client";

import { AUM_LABELS, ROLE_LABELS, STRATEGY_LABELS, displayLabel, titleCase } from "@/lib/labels";
import type { ProfileValues } from "@/components/build/ProfileForm";

// The investor-facing "profile card" — how counterparties see the firm across
// match results, the Capital Map, and ecosystem search. Rendered from live form
// values so it updates as the operator edits and reflects the saved state.

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{label}</span>
      <span className="text-xs font-medium text-fg-primary">{value}</span>
    </div>
  );
}

export function ProfilePreviewCard({
  values,
  discoverable = false,
}: {
  values: ProfileValues;
  discoverable?: boolean;
}) {
  const name = values.name.trim();
  const initial = (name || "?")[0]?.toUpperCase() ?? "?";

  const metaLine = [
    values.operator_role ? displayLabel(values.operator_role, ROLE_LABELS) : null,
    values.entity_type ? titleCase(values.entity_type) : null,
    values.hq_location.trim() || null,
  ]
    .filter(Boolean)
    .join(" · ");

  const tagline = values.tagline.trim();
  const description = values.description.trim();
  const strategy = values.primary_strategy.trim();
  const aum = values.aum_range.trim();
  const fundCount = values.fund_count.trim();
  const jurisdiction = values.jurisdiction.trim();
  const website = values.website.trim();

  return (
    <div className="fx-glass overflow-hidden rounded-2xl border border-gold-500/20 p-6">
      {/* Header row */}
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-gold-500/30 bg-gold-500/10 font-display text-lg font-bold text-gold-300">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-base font-semibold text-fg-primary">
              {name || <span className="italic text-fg-muted">Display name</span>}
            </span>
            {discoverable && (
              <span className="rounded-full border border-green-500/30 bg-green-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-green-400">
                Discoverable
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-fg-secondary">
            {metaLine || (
              <span className="italic text-fg-muted">Role · Entity type · Location</span>
            )}
          </p>
        </div>
      </div>

      {/* Tagline */}
      {tagline ? (
        <p className="mt-3 text-sm font-medium text-fg-primary">{tagline}</p>
      ) : (
        <p className="mt-3 text-sm italic text-fg-muted">Your tagline appears here.</p>
      )}

      {/* Description */}
      {description ? (
        <p className="mt-2 line-clamp-3 text-sm text-fg-secondary">{description}</p>
      ) : (
        <p className="mt-2 text-sm italic text-fg-muted">
          Add a firm description to help LPs and counterparties understand your mandate.
        </p>
      )}

      {/* Stats row */}
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-4">
        {strategy && <Stat label="Strategy" value={displayLabel(strategy, STRATEGY_LABELS)} />}
        {aum && <Stat label="AUM" value={displayLabel(aum, AUM_LABELS)} />}
        {fundCount && <Stat label="Funds" value={fundCount} />}
        {jurisdiction && <Stat label="Jurisdiction" value={jurisdiction} />}
        {website && (
          <a
            href={/^[a-z][a-z0-9+.-]*:\/\//i.test(website) ? website : `https://${website}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gold-400 transition hover:text-gold-300"
          >
            {website} ↗
          </a>
        )}
      </div>
    </div>
  );
}
