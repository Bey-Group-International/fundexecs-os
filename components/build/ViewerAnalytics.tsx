import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { DataRoomShare, DataRoomView, Document } from "@/lib/supabase/database.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(share: DataRoomShare): { text: string; cls: string } {
  if (share.revoked_at) return { text: "Revoked", cls: "text-fg-muted" };
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now())
    return { text: "Expired", cls: "text-fg-muted" };
  return { text: "Active", cls: "text-emerald-400" };
}

// ---------------------------------------------------------------------------
// Types for aggregated analytics
// ---------------------------------------------------------------------------

interface ViewerRow {
  viewerEmail: string | null;
  sessionId: string | null;
  docName: string | null;
  totalSeconds: number;
  viewCount: number;
  lastSeen: string;
}

interface ShareAnalytics {
  share: DataRoomShare;
  uniqueViewers: number;
  totalViews: number;
  totalSeconds: number;
  rows: ViewerRow[];
}

// ---------------------------------------------------------------------------
// ViewerAnalytics — server component
// ---------------------------------------------------------------------------

export async function ViewerAnalytics() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return null;

  const supabase = await createServerClient();

  const [sharesRes, viewsRes, docsRes] = await Promise.all([
    supabase
      .from("data_room_shares")
      .select("*")
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: false }),
    supabase
      .from("data_room_views")
      .select("*")
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: false }),
    supabase
      .from("documents")
      .select("id, name")
      .eq("organization_id", ctx.orgId),
  ]);

  const shares = (sharesRes.data ?? []) as DataRoomShare[];
  const views = (viewsRes.data ?? []) as DataRoomView[];
  const docs = (docsRes.data ?? []) as Pick<Document, "id" | "name">[];

  const docNameById = new Map(docs.map((d) => [d.id, d.name]));

  // Group views by share_id
  const viewsByShare = new Map<string, DataRoomView[]>();
  for (const v of views) {
    const key = v.share_id ?? "__unlinked__";
    const bucket = viewsByShare.get(key);
    if (bucket) bucket.push(v);
    else viewsByShare.set(key, [v]);
  }

  const analytics: ShareAnalytics[] = shares.map((share) => {
    const shareViews = viewsByShare.get(share.id) ?? [];

    // Group by session_id (or viewer_email as fallback) + document
    // to produce per-viewer per-doc rows.
    type AggKey = string;
    const agg = new Map<
      AggKey,
      { viewerEmail: string | null; sessionId: string | null; docId: string | null; totalSeconds: number; viewCount: number; lastSeen: string }
    >();

    for (const v of shareViews) {
      const key = `${v.session_id ?? v.viewer_email ?? "anon"}||${v.document_id ?? ""}`;
      const existing = agg.get(key);
      if (existing) {
        existing.totalSeconds += v.duration_seconds ?? 0;
        existing.viewCount += 1;
        if (v.created_at > existing.lastSeen) existing.lastSeen = v.created_at;
      } else {
        agg.set(key, {
          viewerEmail: v.viewer_email,
          sessionId: v.session_id,
          docId: v.document_id,
          totalSeconds: v.duration_seconds ?? 0,
          viewCount: 1,
          lastSeen: v.created_at,
        });
      }
    }

    const rows: ViewerRow[] = Array.from(agg.values()).map((r) => ({
      viewerEmail: r.viewerEmail,
      sessionId: r.sessionId,
      docName: r.docId ? (docNameById.get(r.docId) ?? null) : null,
      totalSeconds: r.totalSeconds,
      viewCount: r.viewCount,
      lastSeen: r.lastSeen,
    }));

    // Sort by last seen desc
    rows.sort((a, b) => (a.lastSeen > b.lastSeen ? -1 : 1));

    const uniqueViewers = new Set(
      shareViews.map((v) => v.session_id ?? v.viewer_email ?? v.id),
    ).size;

    return {
      share,
      uniqueViewers,
      totalViews: shareViews.length,
      totalSeconds: shareViews.reduce((acc, v) => acc + (v.duration_seconds ?? 0), 0),
      rows,
    };
  });

  const hasAnyData = analytics.some((a) => a.totalViews > 0);

  return (
    <div className="mt-8">
      <div className="mb-5">
        <h3 className="font-display text-lg font-semibold tracking-tight text-fg-primary">
          Viewer Analytics
        </h3>
        <p className="mt-0.5 text-sm text-fg-secondary">
          Engagement data collected from shared data room links.
        </p>
      </div>

      {!hasAnyData ? (
        <div className="rounded-xl border border-dashed border-line bg-surface-1 px-6 py-10 text-center">
          <p className="text-sm text-fg-muted">No viewer activity yet.</p>
          <p className="mt-1 text-xs text-fg-muted">
            Data appears here once someone opens a shared link.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {analytics.map((a) => {
            const st = statusLabel(a.share);
            if (a.totalViews === 0) return null;
            return (
              <div key={a.share.id} className="overflow-hidden rounded-xl border border-line bg-surface-1">
                {/* Share header */}
                <div className="flex flex-wrap items-center gap-3 border-b border-line/60 bg-surface-0 px-5 py-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${st.text === "Active" ? "bg-emerald-400" : "bg-fg-muted/30"}`}
                    />
                    <span className={`font-mono text-[9px] uppercase tracking-wider ${st.cls}`}>
                      {st.text}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-fg-primary">
                    {a.share.label || "Untitled link"}
                  </span>
                  {a.share.expires_at ? (
                    <span className="font-mono text-[9px] text-fg-muted">
                      exp {new Date(a.share.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  ) : null}
                  <div className="ml-auto flex items-center gap-4 font-mono text-[9px] text-fg-muted">
                    <span>{a.uniqueViewers} viewer{a.uniqueViewers !== 1 ? "s" : ""}</span>
                    <span>{a.totalViews} event{a.totalViews !== 1 ? "s" : ""}</span>
                    <span>{fmtDuration(a.totalSeconds)} total</span>
                  </div>
                </div>

                {/* Rows table */}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px] text-sm">
                    <thead>
                      <tr className="border-b border-line/50">
                        <th className="px-5 py-2.5 text-left font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                          Viewer
                        </th>
                        <th className="px-4 py-2.5 text-left font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                          Document / Section
                        </th>
                        <th className="px-4 py-2.5 text-right font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                          Time spent
                        </th>
                        <th className="px-4 py-2.5 text-right font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                          Views
                        </th>
                        <th className="px-5 py-2.5 text-right font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                          Last seen
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/30">
                      {a.rows.map((row, i) => (
                        <tr key={i} className="hover:bg-surface-0/50">
                          <td className="px-5 py-2.5">
                            {row.viewerEmail ? (
                              <span className="text-fg-primary">{row.viewerEmail}</span>
                            ) : (
                              <span className="font-mono text-[10px] text-fg-muted">
                                {row.sessionId ? `anon·${row.sessionId.slice(0, 8)}` : "anonymous"}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-fg-secondary">
                            {row.docName ?? <span className="text-fg-muted">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-[11px] text-fg-secondary">
                            {fmtDuration(row.totalSeconds)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-[11px] text-fg-muted">
                            {row.viewCount}
                          </td>
                          <td className="px-5 py-2.5 text-right font-mono text-[10px] text-fg-muted">
                            {fmtDate(row.lastSeen)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
