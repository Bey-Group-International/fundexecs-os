// Server-side meeting-context loaders for the Earn copilot.
//
// "Prepare with Earn" / "Follow up" gather a meeting plus its linked deal, fund,
// deal lead, and (for follow-up) any saved report, then compose an institutional
// prompt. Crucially this runs SERVER-SIDE and the composed context is injected
// straight into the model call as liveContext — it is never returned to the
// browser. The client only ever sends a clean one-liner ("Prepare me for …"),
// so deal financials, lead emails, and private notes never leave the server.
//
// The loaders are org-scoped: every query filters on the caller's organization,
// so a meeting id from another org yields null (no context, no leak).

import type { createServerClient } from "@/lib/supabase/server";
import { buildPrepPrompt, type PrepAttendee } from "@/lib/meetings/prep";
import { buildFollowupPrompt, type FollowupAttendee } from "@/lib/meetings/followup";

type Supabase = Awaited<ReturnType<typeof createServerClient>>;

type MeetingRow = {
  title: string;
  meeting_type: string | null;
  priority: string | null;
  scheduled_at: string | null;
  timezone: string | null;
  duration_minutes: number | null;
  objective: string | null;
  agenda: string | null;
  preparation_requirements: string | null;
  description: string | null;
  location: string | null;
  tags: string[] | null;
  attendees: (PrepAttendee & FollowupAttendee)[] | null;
  deal_id: string | null;
  related_fund_id: string | null;
};
type DealRow = {
  name: string; stage: string | null; asset_class: string | null; geography: string | null;
  target_amount: number | null; expected_close: string | null; notes: string | null; fund_id: string | null;
  lead_principal: string | null;
};
type PrincipalRow = { full_name: string | null; title: string | null; email: string | null };
type FundRow = {
  name: string; fund_type: string | null; vintage_year: number | null; target_size: number | null;
  committed_capital: number | null; called_capital: number | null; distributed_capital: number | null; currency: string | null;
};
type ReportRow = { summary: string | null; key_points: unknown; action_items: unknown };

const MEETING_COLUMNS =
  "id, title, meeting_type, priority, scheduled_at, timezone, duration_minutes, objective, agenda, preparation_requirements, description, location, tags, attendees, deal_id, related_fund_id";

// Coerce a jsonb column that should hold an array of strings into string[].
function toStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.map((x) => (typeof x === "string" ? x : x == null ? "" : String(x))).filter((s) => s.trim());
  return out.length ? out : null;
}

// Load the org-scoped meeting; null when it isn't in the caller's org.
async function loadMeeting(supabase: Supabase, orgId: string, meetingId: string): Promise<MeetingRow | null> {
  const { data } = await supabase
    .from("live_meetings")
    .select(MEETING_COLUMNS)
    .eq("id", meetingId)
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as MeetingRow | null) ?? null;
}

// Linked deal (well-defined FK to deals), org-scoped.
async function loadDeal(supabase: Supabase, orgId: string, dealId: string | null): Promise<DealRow | null> {
  if (!dealId) return null;
  const { data } = await supabase
    .from("deals")
    .select("name, stage, asset_class, geography, target_amount, expected_close, notes, fund_id, lead_principal")
    .eq("id", dealId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return (data as DealRow | null) ?? null;
}

// Linked fund: the meeting's own pointer, else the deal's vehicle. Org-scoped.
async function loadFund(supabase: Supabase, orgId: string, fundId: string | null): Promise<FundRow | null> {
  if (!fundId) return null;
  const { data } = await supabase
    .from("funds")
    .select("name, fund_type, vintage_year, target_size, committed_capital, called_capital, distributed_capital, currency")
    .eq("id", fundId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return (data as FundRow | null) ?? null;
}

function dealForPrompt(deal: DealRow | null) {
  return deal
    ? {
        name: deal.name,
        stage: deal.stage,
        assetClass: deal.asset_class,
        geography: deal.geography,
        targetAmount: deal.target_amount,
        expectedClose: deal.expected_close,
        notes: deal.notes,
      }
    : null;
}

function fundForPrompt(fund: FundRow | null) {
  return fund
    ? {
        name: fund.name,
        fundType: fund.fund_type,
        vintageYear: fund.vintage_year,
        targetSize: fund.target_size,
        committedCapital: fund.committed_capital,
        calledCapital: fund.called_capital,
        distributedCapital: fund.distributed_capital,
        currency: fund.currency,
      }
    : null;
}

function meetingForPrompt(m: MeetingRow) {
  return {
    title: m.title,
    meetingType: m.meeting_type,
    priority: m.priority,
    scheduledAt: m.scheduled_at,
    timezone: m.timezone,
    durationMinutes: m.duration_minutes,
    objective: m.objective,
    agenda: m.agenda,
    preparationRequirements: m.preparation_requirements,
    description: m.description,
    location: m.location,
    tags: m.tags,
    attendees: m.attendees,
  };
}

/**
 * Compose the institutional PREP context for a meeting (server-side only).
 * Returns null when the meeting isn't in the caller's org. The returned string
 * is meant for model-side injection (liveContext), never for the client.
 */
export async function loadMeetingPrepContext(
  supabase: Supabase,
  orgId: string,
  meetingId: string,
): Promise<string | null> {
  const m = await loadMeeting(supabase, orgId, meetingId);
  if (!m) return null;

  const deal = await loadDeal(supabase, orgId, m.deal_id);

  // Deal lead: deals.lead_principal -> principals. The principals table is a
  // global identity table (keyed on auth.users) with no organization_id, so it
  // is loaded by id without org scope.
  let dealLead: PrincipalRow | null = null;
  if (deal?.lead_principal) {
    const { data } = await supabase
      .from("principals")
      .select("full_name, title, email")
      .eq("id", deal.lead_principal)
      .maybeSingle();
    dealLead = (data as PrincipalRow | null) ?? null;
  }

  const fund = await loadFund(supabase, orgId, m.related_fund_id ?? deal?.fund_id ?? null);

  return buildPrepPrompt({
    meeting: meetingForPrompt(m),
    deal: dealForPrompt(deal),
    dealLead: dealLead ? { name: dealLead.full_name, title: dealLead.title, email: dealLead.email } : null,
    fund: fundForPrompt(fund),
  });
}

/**
 * Compose the institutional FOLLOW-UP context for a meeting (server-side only).
 * Returns null when the meeting isn't in the caller's org. Pulls any saved
 * report (summary / key points / action items) so the follow-up is grounded in
 * what was actually captured. For model-side injection only — never the client.
 */
export async function loadMeetingFollowupContext(
  supabase: Supabase,
  orgId: string,
  meetingId: string,
): Promise<string | null> {
  const m = await loadMeeting(supabase, orgId, meetingId);
  if (!m) return null;

  const deal = await loadDeal(supabase, orgId, m.deal_id);
  const fund = await loadFund(supabase, orgId, m.related_fund_id ?? deal?.fund_id ?? null);

  // Optional saved report notes. live_meeting_reports is keyed by meeting_id;
  // since the meeting is already verified org-scoped above, loading its latest
  // report is transitively org-scoped. Skip gracefully if the table/row is absent.
  let notes: { summary?: string | null; actionItems?: string[] | null; keyPoints?: string[] | null } | null = null;
  try {
    const { data } = await supabase
      .from("live_meeting_reports")
      .select("summary, key_points, action_items")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const r = (data as ReportRow | null) ?? null;
    if (r) {
      notes = {
        summary: r.summary,
        actionItems: toStringArray(r.action_items),
        keyPoints: toStringArray(r.key_points),
      };
    }
  } catch {
    notes = null;
  }

  return buildFollowupPrompt({
    meeting: meetingForPrompt(m),
    deal: dealForPrompt(deal),
    fund: fundForPrompt(fund),
    notes,
  });
}
