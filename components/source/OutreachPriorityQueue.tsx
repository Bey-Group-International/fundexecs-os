"use client";

import React from "react";

interface OutreachItem {
  id: string;
  investorName: string;
  priority: 1 | 2 | 3;
  reason: string;
  suggestedAction: string;
  daysStale: number | null;
  thesisFitScore: number | null;
}

const BUCKETS: { priority: 1 | 2 | 3; label: string; headerCls: string; dotCls: string }[] = [
  { priority: 1, label: "High Priority", headerCls: "text-emerald-300", dotCls: "bg-emerald-300" },
  { priority: 2, label: "Medium Priority", headerCls: "text-gold-400", dotCls: "bg-gold-400" },
  { priority: 3, label: "Low Priority", headerCls: "text-fg-muted", dotCls: "bg-fg-muted" },
];

export function OutreachPriorityQueue({ items }: { items: OutreachItem[] }) {
  const grouped = (priority: 1 | 2 | 3) => items.filter((i) => i.priority === priority);

  const hasAny = items.length > 0;

  return (
    <div className="bg-surface-0 rounded-2xl border border-line p-6 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-semibold text-fg-primary">Outreach Priority Queue</h2>
        <p className="text-sm text-fg-muted">Ranked by urgency, fit, and relationship staleness.</p>
      </div>

      {!hasAny ? (
        <div className="flex items-center justify-center py-12 text-fg-muted text-sm">
          No outreach items queued.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {BUCKETS.map(({ priority, label, headerCls, dotCls }) => {
            const bucket = grouped(priority);
            if (bucket.length === 0) return null;
            return (
              <div key={priority} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${dotCls}`} />
                  <span className={`text-xs font-semibold font-mono uppercase tracking-wider ${headerCls}`}>{label}</span>
                  <span className="text-xs text-fg-muted font-mono">({bucket.length})</span>
                </div>
                <div className="flex flex-col gap-2">
                  {bucket.map((item) => {
                    const isStale = item.daysStale !== null && item.daysStale > 30;
                    return (
                      <div key={item.id} className="bg-surface-1 rounded-2xl border border-line p-4 flex flex-col gap-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <span className="text-sm font-semibold text-fg-primary">{item.investorName}</span>
                          <div className="flex flex-wrap items-center gap-2">
                            {item.thesisFitScore !== null && (
                              <span className="font-mono text-xs text-gold-300">{item.thesisFitScore}% fit</span>
                            )}
                            {item.daysStale !== null && (
                              <span className={`font-mono text-xs ${isStale ? "text-status-danger" : "text-fg-muted"}`}>
                                {isStale ? `>${item.daysStale}d stale` : `${item.daysStale}d ago`}
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-fg-secondary leading-relaxed">{item.reason}</p>
                        <div>
                          <span className="inline-block text-xs px-2.5 py-1 rounded-full bg-surface-0 border border-line text-fg-secondary font-mono">
                            {item.suggestedAction}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
