import Link from "next/link";
import { runWithEarn } from "@/components/execute/actions";

// Shared Execute-hub presentational primitives, server-rendered (no client JS).

// "Run with Earn" launcher — posts a task kind to the runWithEarn server action,
// which seeds an agent-team session on the firm's live books and opens it.
export function EarnAction({
  kind,
  label,
  subject,
  subtle,
}: {
  kind: string;
  label: string;
  subject?: string;
  subtle?: boolean;
}) {
  return (
    <form action={runWithEarn} className="inline">
      <input type="hidden" name="kind" value={kind} />
      {subject ? <input type="hidden" name="subject" value={subject} /> : null}
      <button
        className={
          subtle
            ? "inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300"
            : "inline-flex items-center gap-1.5 rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20 hover:text-gold-200"
        }
      >
        ✶ {label}
      </button>
    </form>
  );
}

// Empty-state scaffold, pointed at wherever the module's data is sourced.
export function EmptyState({ note, href, cta }: { note: string; href: string; cta: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-surface-1 px-8 py-12 text-center">
      <span
        aria-hidden
        className="mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-gold-500/30 bg-gold-500/5 font-mono text-sm text-gold-400"
      >
        ✶
      </span>
      <p className="max-w-sm text-sm text-fg-secondary">{note}</p>
      <Link
        href={href}
        className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20"
      >
        → {cta}
      </Link>
    </div>
  );
}

// A single headline stat tile.
export function StatTile({
  value,
  label,
  tone,
  sub,
}: {
  value: string;
  label: string;
  tone?: "good" | "bad";
  sub?: string;
}) {
  const valueTone =
    tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-status-danger" : "text-fg-primary";
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-line bg-surface-1 px-3.5 py-3">
      <span className={`font-display text-lg font-semibold leading-none ${valueTone}`}>{value}</span>
      <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{label}</span>
      {sub ? <span className="font-mono text-[10px] text-fg-muted">{sub}</span> : null}
    </div>
  );
}
