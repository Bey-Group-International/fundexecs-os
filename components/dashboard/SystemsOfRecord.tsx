import Link from "next/link";
import { relTime, type SystemStatus, type SystemHealth } from "@/lib/dashboard/institutional";

// The systems-of-record status grid: one card per live system (capital, deals,
// portfolio, finance, documents, comms, network, automation). Each shows its
// headline record count, a secondary detail, a health dot, and when it last
// saw activity — so the operator reads the whole operating estate at a glance.
// Pure server component; every card links into that system's live surface.

const HEALTH_DOT: Record<SystemHealth, string> = {
  live: "bg-status-success shadow-[0_0_7px_#5FB87A]",
  steady: "bg-gold-400 shadow-[0_0_6px_rgb(var(--fx-gold-rgb)/0.6)]",
  empty: "bg-line",
};

const HEALTH_LABEL: Record<SystemHealth, string> = {
  live: "Live",
  steady: "Steady",
  empty: "No records",
};

export function SystemsOfRecord({ systems }: { systems: SystemStatus[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {systems.map((s) => (
        <Link
          key={s.key}
          href={s.href}
          className="fx-card fx-card-hover group relative flex flex-col gap-2 overflow-hidden p-4"
        >
          {/* Top hairline that brightens on hover */}
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/40 to-transparent opacity-60 transition-opacity duration-300 group-hover:opacity-100"
          />
          <div className="flex items-start justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-muted">
              {s.label}
            </span>
            <span
              className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${HEALTH_DOT[s.health]}`}
              title={HEALTH_LABEL[s.health]}
            />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-2xl font-bold leading-none tracking-tight text-fg-primary transition-colors duration-200 group-hover:text-white">
              {s.primary}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              {s.unit}
            </span>
          </div>
          {s.detail ? (
            <p className="truncate text-[11px] text-fg-secondary">{s.detail}</p>
          ) : null}
          <p className="mt-auto pt-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted/70">
            {s.health === "empty" ? "Awaiting first record" : `Updated ${relTime(s.lastActivity)}`}
          </p>
        </Link>
      ))}
    </div>
  );
}
