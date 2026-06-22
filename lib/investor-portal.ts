// Execute-hub investor portal helpers: engagement signal for the read-only LP
// statement links. Pure — turns the raw view log into a per-share count + last
// opened, so IR can see whether a holder has actually looked at their statement.

export interface PortalViewLike {
  share_id: string | null;
  created_at: string;
}

export interface PortalEngagement {
  count: number;
  last: string | null; // ISO timestamp of the most recent view
}

/** Group portal views by share into a count + most-recent-view timestamp. */
export function summarizePortalViews(views: PortalViewLike[]): Map<string, PortalEngagement> {
  const out = new Map<string, PortalEngagement>();
  for (const v of views) {
    if (!v.share_id) continue;
    const e = out.get(v.share_id) ?? { count: 0, last: null };
    e.count += 1;
    if (!e.last || v.created_at > e.last) e.last = v.created_at;
    out.set(v.share_id, e);
  }
  return out;
}
