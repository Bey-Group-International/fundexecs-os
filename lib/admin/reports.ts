// Cross-org reporting for the platform-admin console. Every read here goes
// through the service-role client (RLS-bypassing) because a platform admin sees
// the WHOLE deployment, not one org. This module is server-only and must only
// ever be reached after requirePlatformAdmin() has passed — the gate lives in
// the /admin layout and the /api/admin/* routes, never here. It is server-only
// by construction — createServiceClient reads SUPABASE_SERVICE_ROLE_KEY, which
// is never present in the browser bundle.
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SignupRow {
  id: string;
  email: string;
  fullName: string | null;
  title: string | null;
  createdAt: string;
  orgId: string | null;
  orgName: string | null;
  role: string | null;
  sessionsStarted: number;
  auditActions: number;
  lastActiveAt: string | null;
}

export interface TractionMetrics {
  totalUsers: number;
  totalOrgs: number;
  newUsers24h: number;
  newUsers7d: number;
  newUsers30d: number;
  dau: number;
  wau: number;
  mau: number;
  /** Signups bucketed per calendar day (UTC) for the last 30 days, oldest → newest. */
  signupsByDay: { date: string; count: number }[];
}

export interface FunnelStep {
  key: string;
  label: string;
  count: number | null; // null = not measurable from available data
  note?: string;
}

export interface AdminReport {
  generatedAt: string;
  metrics: TractionMetrics;
  signups: SignupRow[];
  funnel: FunnelStep[];
  /** True when Supabase service-role env is missing — the UI shows a setup hint. */
  degraded: boolean;
}

/** Bucket an ISO timestamp to its UTC calendar day (YYYY-MM-DD). */
function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Assemble the full admin report in a handful of cross-org queries. Small,
 * pre-alpha data volumes make in-memory aggregation the simplest correct
 * approach; the reporting indexes (migration 20260708120000) keep the scans
 * cheap as the base grows. Never throws — a missing table or transient error
 * degrades a section to empty rather than 500-ing the whole console.
 */
export async function getAdminReport(): Promise<AdminReport> {
  const now = Date.now();
  const generatedAt = new Date(now).toISOString();

  if (!hasSupabaseServiceEnv()) {
    return {
      generatedAt,
      metrics: emptyMetrics(),
      signups: [],
      funnel: [],
      degraded: true,
    };
  }

  const supabase = createServiceClient();
  const cut24h = new Date(now - DAY_MS).toISOString();
  const cut7d = new Date(now - 7 * DAY_MS).toISOString();
  const cut30d = new Date(now - 30 * DAY_MS).toISOString();

  // Pull the raw rows we aggregate over. Each is defensively defaulted so one
  // failing table can't sink the report.
  const [
    principalsRes,
    membersRes,
    orgsRes,
    sessionsRes,
    auditRes,
    orgsCountRes,
  ] = await Promise.all([
    supabase
      .from("principals")
      .select("id, email, full_name, title, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("organization_members")
      .select("principal_id, organization_id, role, created_at")
      .order("created_at", { ascending: true }),
    supabase.from("organizations").select("id, name"),
    // Sessions attribute activity to their creator (a principal).
    supabase.from("sessions").select("created_by, created_at"),
    // Audit log rows attribute activity to a principal too.
    supabase.from("audit_log").select("principal_id, created_at"),
    supabase.from("organizations").select("id", { count: "exact", head: true }),
  ]);

  const principals = principalsRes.data ?? [];
  const members = membersRes.data ?? [];
  const orgs = orgsRes.data ?? [];
  const sessions = sessionsRes.data ?? [];
  const audits = auditRes.data ?? [];

  const orgNameById = new Map<string, string>();
  for (const o of orgs) orgNameById.set(o.id, o.name);

  // First membership per principal → their "home" org + role (matches the
  // active-org rule in lib/auth.ts).
  const membershipByPrincipal = new Map<
    string,
    { orgId: string; role: string | null }
  >();
  for (const m of members) {
    if (!m.principal_id || membershipByPrincipal.has(m.principal_id)) continue;
    membershipByPrincipal.set(m.principal_id, {
      orgId: m.organization_id,
      role: (m.role as string | null) ?? null,
    });
  }

  // Per-principal activity: session count, audit count, and last-active (the
  // most recent of either). We also track which principals were active within
  // each rolling window for DAU/WAU/MAU.
  const sessionsByPrincipal = new Map<string, number>();
  const auditByPrincipal = new Map<string, number>();
  const lastActiveByPrincipal = new Map<string, string>();
  const active24h = new Set<string>();
  const active7d = new Set<string>();
  const active30d = new Set<string>();

  function recordActivity(principalId: string | null, at: string | null) {
    if (!principalId || !at) return;
    const prev = lastActiveByPrincipal.get(principalId);
    if (!prev || at > prev) lastActiveByPrincipal.set(principalId, at);
    if (at >= cut24h) active24h.add(principalId);
    if (at >= cut7d) active7d.add(principalId);
    if (at >= cut30d) active30d.add(principalId);
  }

  for (const s of sessions) {
    if (!s.created_by) continue;
    sessionsByPrincipal.set(
      s.created_by,
      (sessionsByPrincipal.get(s.created_by) ?? 0) + 1,
    );
    recordActivity(s.created_by, s.created_at ?? null);
  }
  for (const a of audits) {
    if (!a.principal_id) continue;
    auditByPrincipal.set(
      a.principal_id,
      (auditByPrincipal.get(a.principal_id) ?? 0) + 1,
    );
    recordActivity(a.principal_id, a.created_at ?? null);
  }

  const signups: SignupRow[] = principals.map((p) => {
    const membership = membershipByPrincipal.get(p.id);
    return {
      id: p.id,
      email: p.email,
      fullName: p.full_name,
      title: p.title,
      createdAt: p.created_at,
      orgId: membership?.orgId ?? null,
      orgName: membership ? (orgNameById.get(membership.orgId) ?? null) : null,
      role: membership?.role ?? null,
      sessionsStarted: sessionsByPrincipal.get(p.id) ?? 0,
      auditActions: auditByPrincipal.get(p.id) ?? 0,
      lastActiveAt: lastActiveByPrincipal.get(p.id) ?? null,
    };
  });

  // Signups-by-day for the last 30 days, zero-filled so the chart has a bar per
  // day even on quiet days.
  const byDay = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    byDay.set(dayKey(new Date(now - i * DAY_MS).toISOString()), 0);
  }
  for (const p of principals) {
    if (p.created_at < cut30d) continue;
    const key = dayKey(p.created_at);
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  const signupsByDay = [...byDay.entries()].map(([date, count]) => ({
    date,
    count,
  }));

  const totalUsers = principals.length;
  const newUsers24h = principals.filter((p) => p.created_at >= cut24h).length;
  const newUsers7d = principals.filter((p) => p.created_at >= cut7d).length;
  const newUsers30d = principals.filter((p) => p.created_at >= cut30d).length;

  const metrics: TractionMetrics = {
    totalUsers,
    totalOrgs: orgsCountRes.count ?? orgs.length,
    newUsers24h,
    newUsers7d,
    newUsers30d,
    dau: active24h.size,
    wau: active7d.size,
    mau: active30d.size,
    signupsByDay,
  };

  // Signup funnel from the data we actually have. We don't track anonymous
  // visitors, so the top of the funnel is left unmeasured (null) rather than
  // faked. Downstream steps are honest subsets:
  //   signed up  → a principal exists
  //   onboarded  → joined/created an org (has a membership)
  //   activated  → did something (≥1 session or audit action)
  //   active 7d  → activity in the last 7 days (retained)
  const onboarded = signups.filter((s) => s.orgId != null).length;
  const activated = signups.filter(
    (s) => s.sessionsStarted > 0 || s.auditActions > 0,
  ).length;
  const funnel: FunnelStep[] = [
    {
      key: "visited",
      label: "Visited",
      count: null,
      note: "Anonymous visits aren't tracked yet",
    },
    { key: "signed_up", label: "Signed up", count: totalUsers },
    {
      key: "onboarded",
      label: "Onboarded",
      count: onboarded,
      note: "Created or joined an organization",
    },
    {
      key: "activated",
      label: "Activated",
      count: activated,
      note: "Started ≥1 session or took an action",
    },
    {
      key: "retained_7d",
      label: "Active last 7d",
      count: active7d.size,
      note: "Any activity in the past week",
    },
  ];

  return { generatedAt, metrics, signups, funnel, degraded: false };
}

function emptyMetrics(): TractionMetrics {
  return {
    totalUsers: 0,
    totalOrgs: 0,
    newUsers24h: 0,
    newUsers7d: 0,
    newUsers30d: 0,
    dau: 0,
    wau: 0,
    mau: 0,
    signupsByDay: [],
  };
}
