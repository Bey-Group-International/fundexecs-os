"use client";

import { useMemo } from "react";

// A short, dependency-free fallback for runtimes without
// Intl.supportedValuesOf. Covers the zones a private-markets audience actually
// books from; the detected zone is always added on top, so nobody is stuck.
const FALLBACK_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Zurich",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Mumbai",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export function TimezoneSelect({
  value,
  onChange,
  label = "Timezone",
  id = "timezone",
}: {
  value: string;
  onChange: (timezone: string) => void;
  label?: string;
  id?: string;
}) {
  const zones = useMemo(() => {
    let list = FALLBACK_ZONES;
    try {
      const supported = (
        Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
      ).supportedValuesOf?.("timeZone");
      if (supported?.length) list = supported;
    } catch {
      // Keep the fallback.
    }
    return [...new Set([value, ...list])].filter(Boolean);
  }, [value]);

  return (
    <label htmlFor={id} className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
      <GlobeIcon />
      <span className="sr-only">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[15rem] truncate rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--fg-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

function GlobeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
