import { createClient } from '@/lib/supabase/server';

/* ============================================================================
 * lib/queries/admin-snapshots.ts — the Admin Overview's compounding picture.
 *
 * The Overview funnel is computed live on each render and thrown away, so the
 * portal can show where the launch IS but never how fast it's MOVING. The
 * settings page captures one snapshot per org per day (the SECURITY DEFINER
 * `upsert_admin_launch_snapshot` RPC, mirroring captureTrustSnapshot on
 * /trust) and this loader turns the history into deltas + a short series the
 * Overview renders as momentum. No cron: the trend builds passively as admins
 * use the portal. Best-effort everywhere — a snapshot failure never breaks the
 * page, and an empty history renders an honest "trends build daily" state.
 * ========================================================================= */

/** The launch counts persisted per org per day. */
export interface LaunchCounts {
  members: number;
  invitesSent: number;
  invitesAccepted: number;
  applications: number;
  applicationsApproved: number;
  referredCount: number;
  creditsEarned: number;
}

/** One day of launch history (UTC date + that day's counts). */
export interface LaunchTrendPoint extends LaunchCounts {
  date: string;
}

export interface LaunchTrend {
  /**
   * Live counts minus the most recent PRIOR-day snapshot — null until at least
   * one earlier day exists, so day one shows an honest "no trend yet" state
   * instead of fake zeros.
   */
  deltas: LaunchCounts | null;
  /** The snapshot date the deltas compare against (UTC date string). */
  sinceDate: string | null;
  /** Oldest→newest history, capped to the last 14 days, including today. */
  series: LaunchTrendPoint[];
}

const EMPTY_TREND: LaunchTrend = { deltas: null, sinceDate: null, series: [] };

const clamp = (n: number) => Math.max(0, Math.round(Number(n) || 0));

/**
 * Persist today's launch counts (idempotent per org per day). Called from the
 * settings page render once the admin data is loaded, so the snapshot reuses
 * numbers the page already computed. Best-effort: never throws.
 */
export async function captureAdminLaunchSnapshot(
  orgId: string,
  counts: LaunchCounts
): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.rpc('upsert_admin_launch_snapshot', {
      _org_id: orgId,
      _members: clamp(counts.members),
      _invites_sent: clamp(counts.invitesSent),
      _invites_accepted: clamp(counts.invitesAccepted),
      _applications: clamp(counts.applications),
      _applications_approved: clamp(counts.applicationsApproved),
      _referred_count: clamp(counts.referredCount),
      _credits_earned: clamp(counts.creditsEarned)
    });
  } catch (err) {
    // Best-effort telemetry; warn so a missing migration stays diagnosable.
    console.warn('[captureAdminLaunchSnapshot] failed to persist snapshot:', err);
  }
}

/**
 * Build the momentum picture for the Overview: deltas of today's LIVE counts
 * against the most recent prior-day snapshot, plus a short series (history +
 * today's live point). RLS-scoped reads; any failure degrades to an empty
 * trend so the Overview still renders.
 */
export async function getAdminLaunchTrend(orgId: string, live: LaunchCounts): Promise<LaunchTrend> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('admin_launch_snapshots')
      .select(
        'snapshot_date, members, invites_sent, invites_accepted, applications, applications_approved, referred_count, credits_earned'
      )
      .eq('org_id', orgId)
      .order('snapshot_date', { ascending: false })
      .limit(14);
    if (error || !data) return EMPTY_TREND;

    const today = new Date().toISOString().slice(0, 10);
    const history: LaunchTrendPoint[] = data
      .map((row) => ({
        date: row.snapshot_date,
        members: row.members,
        invitesSent: row.invites_sent,
        invitesAccepted: row.invites_accepted,
        applications: row.applications,
        applicationsApproved: row.applications_approved,
        referredCount: row.referred_count,
        creditsEarned: row.credits_earned
      }))
      .reverse();

    // Compare live values against the newest snapshot from a PREVIOUS day —
    // today's own row (already upserted by the capture call) is not a trend.
    const baseline = [...history].reverse().find((p) => p.date < today) ?? null;
    const deltas: LaunchCounts | null = baseline
      ? {
          members: live.members - baseline.members,
          invitesSent: live.invitesSent - baseline.invitesSent,
          invitesAccepted: live.invitesAccepted - baseline.invitesAccepted,
          applications: live.applications - baseline.applications,
          applicationsApproved: live.applicationsApproved - baseline.applicationsApproved,
          referredCount: live.referredCount - baseline.referredCount,
          creditsEarned: live.creditsEarned - baseline.creditsEarned
        }
      : null;

    const series: LaunchTrendPoint[] = [
      ...history.filter((p) => p.date !== today),
      { date: today, ...live }
    ].slice(-14);

    return { deltas, sinceDate: baseline?.date ?? null, series };
  } catch {
    return EMPTY_TREND;
  }
}
