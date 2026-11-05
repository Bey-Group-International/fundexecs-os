import Link from "next/link";
import type { DashboardData } from "@/lib/dashboard/types";

/**
 * The one status line on the dashboard: a single dot, then the counts. It used to
 * be a glowing "FundExecs OS live" bar sitting under two other "live" indicators.
 * The main Command Center shows approvals in its Needs-you strip instead, so it
 * passes `showApprovals={false}` there to avoid counting the same thing twice.
 */
export function DashboardHUD({
  data,
  showApprovals = true,
}: {
  data: DashboardData;
  showApprovals?: boolean;
}) {
  const approvals = data.approvals.length;
  const activeTasks = data.tasks.filter((task) =>
    ["pending", "in_progress", "awaiting_approval", "blocked"].includes(task.status),
  ).length;
  const enabledAutomations = data.automations.filter((automation) => automation.enabled).length;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-fg-secondary">
      <span className="flex items-center gap-1.5" title="Systems operational">
        <span aria-hidden className="h-2 w-2 rounded-full bg-status-success" />
        <span className="sr-only">Systems operational</span>
      </span>
      <span>
        {activeTasks} active task{activeTasks === 1 ? "" : "s"}
      </span>
      {showApprovals ? (
        <Link href="/grid/review" className="hover:text-gold-300">
          {approvals} approval gate{approvals === 1 ? "" : "s"}
        </Link>
      ) : null}
      <Link href="/automations" className="hover:text-gold-300">
        {enabledAutomations} automation{enabledAutomations === 1 ? "" : "s"} enabled
      </Link>
    </div>
  );
}
