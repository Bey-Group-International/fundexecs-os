"use client";

import { useState } from "react";

export interface AnalyticsView {
  id: string;
  share_id: string | null;
  document_id: string | null;
  kind: "room" | "document";
  created_at: string;
  viewer_email: string | null;
  duration_seconds: number | null;
}

export interface AnalyticsShare {
  id: string;
  token: string;
  label: string | null;
  revoked_at: string | null;
}

export interface AnalyticsDoc {
  id: string;
  name: string;
}

function fmt(sec: number | null): string {
  if (!sec || sec < 5) return "";
  if (sec < 60) return `${Math.round(sec)}s`;
  return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function AnalyticsPanel({
  shares,
  views,
  docs,
}: {
  shares: AnalyticsShare[];
  views: AnalyticsView[];
  docs: AnalyticsDoc[];
}) {
  const [activeShare, setActiveShare] = useState<string | "all">("all");

  const docName = new Map(docs.map((d) => [d.id, d.name]));
  const shareLabel = new Map(shares.map((s) => [s.id, s.label || "Untitled link"]));

  const filtered = activeShare === "all" ? views : views.filter((v) => v.share_id === activeShare);

  // Per-share stats
  const shareStats = shares.map((s) => {
    const sv = views.filter((v) => v.share_id === s.id);
    const roomViews = sv.filter((v) => v.kind === "room").length;
    const docViews = sv.filter((v) => v.kind === "document").length;
    const uniqueEmails = new Set(sv.map((v) => v.viewer_email).filter(Boolean)).size;
    const lastView = sv[0]?.created_at ?? null;
    return { share: s, roomViews, docViews, uniqueEmails, lastView };
  });

  // Document view counts for the selected share filter
  const docCounts = new Map<string, { views: number; totalSec: number }>();
  for (const v of filtered) {
    if (v.kind === "document" && v.document_id) {
      const cur = docCounts.get(v.document_id) ?? { views: 0, totalSec: 0 };
      cur.views += 1;
      cur.totalSec += v.duration_seconds ?? 0;
      docCounts.set(v.document_id, cur);
    }
  }
  const docRows = [...docCounts.entries()]
    .map(([id, s]) => ({ id, name: docName.get(id) ?? "Document", ...s }))
    .sort((a, b) => b.views - a.views);

  // Recent activity feed
  const recent = filtered.slice(0, 15);

  const totalRoomViews = views.filter((v) => v.kind === "room").length;
  const totalDocViews = views.filter((v) => v.kind === "document").length;
  const uniqueViewers = new Set(views.map((v) => v.viewer_email).filter(Boolean)).size;

  if (views.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface-1 px-4 py-8 text-center">
        <p className="text-sm text-fg-muted">No views yet — share a link and activity will appear here.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Headline stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Room opens", value: totalRoomViews },
          { label: "Doc views", value: totalDocViews },
          { label: "Unique viewers", value: uniqueViewers },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-line bg-surface-0 px-4 py-3 text-center">
            <p className="font-display text-2xl font-semibold text-fg-primary">{value}</p>
            <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">{label}</p>
          </div>
        ))}
      </div>

      {/* Per-share breakdown */}
      {shareStats.length > 0 && (
        <div>
          <p className="mb-2 font-mono text-[9px] uppercase tracking-wider text-fg-muted">By share link</p>
          <div className="flex flex-col gap-1.5">
            {shareStats.map(({ share, roomViews, docViews, uniqueEmails, lastView }) => (
              <button
                key={share.id}
                type="button"
                onClick={() => setActiveShare(activeShare === share.id ? "all" : share.id)}
                className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition ${
                  activeShare === share.id
                    ? "border-gold-500/40 bg-gold-500/10"
                    : "border-line bg-surface-0 hover:bg-surface-1"
                }`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${share.revoked_at ? "bg-fg-muted/40" : "bg-emerald-400"}`} />
                <span className="flex-1 truncate text-sm text-fg-primary">{share.label || "Untitled link"}</span>
                <span className="shrink-0 font-mono text-[9px] text-fg-muted">
                  {roomViews} open{roomViews !== 1 ? "s" : ""}
                  {docViews > 0 ? ` · ${docViews} doc view${docViews !== 1 ? "s" : ""}` : ""}
                  {uniqueEmails > 0 ? ` · ${uniqueEmails} viewer${uniqueEmails !== 1 ? "s" : ""}` : ""}
                </span>
                {lastView && (
                  <span className="shrink-0 font-mono text-[9px] text-fg-muted">{relTime(lastView)}</span>
                )}
              </button>
            ))}
          </div>
          {activeShare !== "all" && (
            <button
              type="button"
              onClick={() => setActiveShare("all")}
              className="mt-1.5 font-mono text-[9px] uppercase tracking-wider text-gold-400 hover:underline"
            >
              ← All links
            </button>
          )}
        </div>
      )}

      {/* Document heatmap */}
      {docRows.length > 0 && (
        <div>
          <p className="mb-2 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
            Document engagement{activeShare !== "all" ? ` · ${shareLabel.get(activeShare) ?? ""}` : ""}
          </p>
          <div className="flex flex-col gap-1">
            {docRows.map((row) => {
              const maxViews = docRows[0].views;
              const pct = maxViews > 0 ? Math.round((row.views / maxViews) * 100) : 0;
              return (
                <div key={row.id} className="flex items-center gap-3 rounded-lg border border-line/60 bg-surface-0 px-3 py-2">
                  <div className="relative min-w-0 flex-1">
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-gold-500/10"
                      style={{ width: `${pct}%` }}
                    />
                    <span className="relative truncate text-sm text-fg-primary">{row.name}</span>
                  </div>
                  <span className="shrink-0 font-mono text-[9px] text-fg-muted">
                    {row.views} view{row.views !== 1 ? "s" : ""}
                    {row.totalSec > 0 ? ` · avg ${fmt(Math.round(row.totalSec / row.views))}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent activity feed */}
      <div>
        <p className="mb-2 font-mono text-[9px] uppercase tracking-wider text-fg-muted">Recent activity</p>
        <div className="flex flex-col gap-1">
          {recent.map((v) => (
            <div key={v.id} className="flex items-center gap-3 rounded-lg border border-line/60 bg-surface-0 px-3 py-2">
              <span className="shrink-0 font-mono text-[10px] text-fg-muted">
                {v.kind === "room" ? "🏠" : "📄"}
              </span>
              <span className="flex-1 truncate text-sm text-fg-secondary">
                {v.kind === "room"
                  ? "Opened data room"
                  : `Viewed: ${v.document_id ? (docName.get(v.document_id) ?? "Document") : "—"}`}
              </span>
              {v.viewer_email && (
                <span className="shrink-0 font-mono text-[9px] text-fg-muted">{v.viewer_email}</span>
              )}
              {v.share_id && (
                <span className="shrink-0 font-mono text-[9px] text-fg-muted/60">
                  {shareLabel.get(v.share_id) ?? ""}
                </span>
              )}
              <span className="shrink-0 font-mono text-[9px] text-fg-muted">{relTime(v.created_at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
