import Link from "next/link";
import type { DashboardData } from "@/lib/dashboard/types";

export function DashboardHUD({ data }: { data: DashboardData }) {
  const approvals = data.approvals.length;
  const activeTasks = data.tasks.filter((task) =>
    ["pending", "in_progress", "awaiting_approval", "blocked"].includes(task.status),
  ).length;
  const enabledAutomations = data.automations.filter((automation) => automation.enabled).length;

  return (
    <div className="rounded-2xl border border-gold-500/25 bg-surface-1/80 px-4 py-3 shadow-[0_18px_60px_-42px_rgba(251,191,36,0.8)] backdrop-blur">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-gold-400 shadow-[0_0_12px_rgba(251,191,36,0.9)]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-300">
            FundExecs OS live
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary sm:ml-auto">
          <span>{activeTasks} active task{activeTasks === 1 ? "" : "s"}</span>
          <Link href="/workspace" className="hover:text-gold-300">
            {approvals} approval gate{approvals === 1 ? "" : "s"}
          </Link>
          <Link href="/automations" className="hover:text-gold-300">
            {enabledAutomations} automation{enabledAutomations === 1 ? "" : "s"} enabled
          </Link>
        </div>
      </div>
    </div>
  );
}
