import Link from "next/link";
import { relativeTime } from "./format";

export interface MobileWorkflow {
  id: string;
  title: string;
  agentLabel: string | null;
  agentColor: string | null;
  status: string;
  statusLabel: string;
  progress: number;
  updatedAt: string | null;
  href: string;
}

const STATUS_TONE: Record<string, string> = {
  in_progress: "text-neural-300",
  awaiting_approval: "text-gold-400",
  queued: "text-fg-secondary",
  running: "text-neural-300",
  completed: "text-status-success",
  failed: "text-status-danger",
};

// Active workflow / delegated-task card. Shows which executive agent owns the
// work, live progress, and status — the "watch Earn delegate" surface.
export function MobileWorkflowCard({ workflow }: { workflow: MobileWorkflow }) {
  const tone = STATUS_TONE[workflow.status] ?? "text-fg-secondary";
  const pct = Math.max(0, Math.min(100, Math.round(workflow.progress)));
  const updated = relativeTime(workflow.updatedAt);
  return (
    <Link
      href={workflow.href}
      className="fx-tap group block rounded-2xl border border-line/60 bg-surface-1/70 p-3.5 transition active:scale-[0.99] active:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex items-start gap-2.5">
          <span
            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: workflow.agentColor ?? "rgb(var(--fx-accent-400))" }}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium leading-tight text-fg-primary">{workflow.title}</p>
            <p className="mt-0.5 truncate text-[11.5px] text-fg-secondary">
              {workflow.agentLabel ?? "Earn"}
              {updated ? ` · ${updated}` : ""}
            </p>
          </div>
        </div>
        <span className={`shrink-0 font-mono text-[9px] uppercase tracking-wide ${tone}`}>{workflow.statusLabel}</span>
      </div>
      {workflow.status !== "completed" && workflow.status !== "failed" && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-gradient-to-r from-neural-400 to-gold-400 transition-[width] duration-500"
            style={{ width: `${pct || 6}%` }}
          />
        </div>
      )}
    </Link>
  );
}
