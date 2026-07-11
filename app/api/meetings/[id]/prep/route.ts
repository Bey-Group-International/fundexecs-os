import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { buildPrepPrompt, type PrepAttendee } from "@/lib/meetings/prep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

type DealRow = {
  name: string; stage: string | null; asset_class: string | null; geography: string | null;
  target_amount: number | null; expected_close: string | null; notes: string | null; fund_id: string | null;
};
type FundRow = {
  name: string; fund_type: string | null; vintage_year: number | null; target_size: number | null;
  committed_capital: number | null; called_capital: number | null; distributed_capital: number | null; currency: string | null;
};

// GET /api/meetings/[id]/prep
// Gathers the meeting plus its linked deal / fund (all org-scoped) and returns a
// composed institutional prep prompt for "Prepare with Earn". Read-only.
export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const supabase = await createServerClient();

  const { data: meeting } = await supabase
    .from("live_meetings")
    .select(
      "id, title, meeting_type, priority, scheduled_at, timezone, duration_minutes, objective, agenda, preparation_requirements, description, location, tags, attendees, deal_id, related_fund_id",
    )
    .eq("id", id)
    .eq("organization_id", auth.ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  const m = meeting as {
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
    attendees: PrepAttendee[] | null;
    deal_id: string | null;
    related_fund_id: string | null;
  } | null;

  if (!m) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  // Linked deal (well-defined FK to deals).
  let deal: DealRow | null = null;
  if (m.deal_id) {
    const { data } = await supabase
      .from("deals")
      .select("name, stage, asset_class, geography, target_amount, expected_close, notes, fund_id")
      .eq("id", m.deal_id)
      .eq("organization_id", auth.ctx.orgId)
      .maybeSingle();
    deal = (data as DealRow | null) ?? null;
  }

  // Linked fund: the meeting's own fund pointer, else the deal's vehicle.
  const fundId = m.related_fund_id ?? deal?.fund_id ?? null;
  let fund: FundRow | null = null;
  if (fundId) {
    const { data } = await supabase
      .from("funds")
      .select("name, fund_type, vintage_year, target_size, committed_capital, called_capital, distributed_capital, currency")
      .eq("id", fundId)
      .eq("organization_id", auth.ctx.orgId)
      .maybeSingle();
    fund = (data as FundRow | null) ?? null;
  }

  const prompt = buildPrepPrompt({
    meeting: {
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
    },
    deal: deal
      ? {
          name: deal.name,
          stage: deal.stage,
          assetClass: deal.asset_class,
          geography: deal.geography,
          targetAmount: deal.target_amount,
          expectedClose: deal.expected_close,
          notes: deal.notes,
        }
      : null,
    fund: fund
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
      : null,
  });

  return NextResponse.json({ prompt });
}
