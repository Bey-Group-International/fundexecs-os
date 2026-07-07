import Link from "next/link";
import { initials, relativeTime } from "./format";

export interface MobileContact {
  id: string;
  name: string;
  role: string | null;
  org: string | null;
  stage: string | null;
  lastInteraction: string | null;
  nextAction: string | null;
  href: string;
  priority?: "high" | "medium" | "low";
}

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-status-danger",
  medium: "bg-gold-400",
  low: "bg-fg-muted",
};

// Relationship card for the mobile Network. Answers "who should I follow up
// with?" at a glance: identity, stage, last touch, and the next move.
export function MobileContactCard({ contact }: { contact: MobileContact }) {
  const last = relativeTime(contact.lastInteraction);
  return (
    <Link
      href={contact.href}
      className="fx-tap group block rounded-2xl border border-line/60 bg-surface-1/70 p-3.5 transition active:scale-[0.99] active:bg-surface-2"
    >
      <div className="flex items-center gap-3">
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 font-display text-[13px] font-semibold text-fg-secondary">
          {initials(contact.name)}
          {contact.priority && (
            <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface-1 ${PRIORITY_DOT[contact.priority]}`} aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight text-fg-primary">{contact.name}</p>
          <p className="mt-0.5 truncate text-[12px] text-fg-secondary">
            {[contact.role, contact.org].filter(Boolean).join(" · ") || "Contact"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {contact.stage && (
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-fg-secondary">
              {contact.stage}
            </span>
          )}
          {last && <span className="text-[10px] text-fg-muted">{last}</span>}
        </div>
      </div>
      {contact.nextAction && (
        <p className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-neural-400/20 bg-neural-400/[0.05] px-2 py-1.5 text-[11.5px] leading-snug text-neural-300">
          <span aria-hidden className="mt-px">✦</span>
          <span className="min-w-0">{contact.nextAction}</span>
        </p>
      )}
    </Link>
  );
}
