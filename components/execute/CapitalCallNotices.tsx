"use client";

export interface CapitalCallNotice {
  id: string;
  fundName: string;
  callAmount: number;
  callDate: string;
  dueDate: string;
  status: "pending" | "sent" | "paid" | "overdue";
  lpName: string;
  commitmentAmount: number;
  callPercentage: number;
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

const STATUS_CONFIG: Record<
  CapitalCallNotice["status"],
  { label: string; badgeClass: string; amountClass: string }
> = {
  pending: {
    label: "Pending",
    badgeClass: "bg-zinc-800 text-fg-muted border-zinc-700",
    amountClass: "text-fg-muted",
  },
  sent: {
    label: "Sent",
    badgeClass: "bg-yellow-950 text-gold-400 border-yellow-800",
    amountClass: "text-gold-300",
  },
  paid: {
    label: "Paid",
    badgeClass: "bg-emerald-950 text-emerald-300 border-emerald-800",
    amountClass: "text-emerald-300",
  },
  overdue: {
    label: "Overdue",
    badgeClass: "bg-red-950 text-status-danger border-red-800",
    amountClass: "text-status-danger",
  },
};

export function CapitalCallNotices({ notices }: { notices: CapitalCallNotice[] }) {
  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-4 sm:p-5 flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-mono uppercase tracking-widest text-xs text-fg-muted">Capital Call Notices</h2>
        <p className="text-fg-secondary text-sm">FundWave-style capital call tracking by fund and LP.</p>
      </div>

      {notices.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <p className="text-fg-muted text-sm font-mono">No capital call notices</p>
          <p className="text-fg-muted text-xs">Capital call notices will appear here when created.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {notices.map((notice) => {
            const cfg = STATUS_CONFIG[notice.status];
            const isOverdue = notice.status === "overdue";
            return (
              <div
                key={notice.id}
                className={`rounded-2xl bg-surface-0 border border-line flex flex-col gap-3 p-4 relative overflow-hidden ${isOverdue ? "border-l-4 border-l-red-600" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-fg-primary text-sm font-medium truncate">{notice.fundName}</span>
                    <span className="text-fg-muted text-xs truncate">{notice.lpName}</span>
                  </div>
                  <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-mono ${cfg.badgeClass}`}>
                    {cfg.label}
                  </span>
                </div>

                <div className="flex flex-col gap-0.5">
                  <span className={`font-display text-2xl font-bold tabular-nums ${cfg.amountClass}`}>
                    {fmtUsd(notice.callAmount)}
                  </span>
                  <span className="text-fg-muted text-xs font-mono">
                    {notice.callPercentage.toFixed(1)}% of {fmtUsd(notice.commitmentAmount)} commitment
                  </span>
                </div>

                <div className="h-px bg-line" />

                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-fg-muted text-xs font-mono uppercase tracking-wide">Call Date</span>
                    <span className="text-fg-secondary text-xs font-mono">{notice.callDate}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className={`text-xs font-mono uppercase tracking-wide ${isOverdue ? "text-status-danger" : "text-fg-muted"}`}>
                      Due Date
                    </span>
                    <span className={`text-xs font-mono ${isOverdue ? "text-status-danger font-semibold" : "text-fg-secondary"}`}>
                      {notice.dueDate}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
