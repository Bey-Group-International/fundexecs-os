import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("live_meetings")
    .select("id, room_code, title, description, location, meeting_url, status, scheduled_at, duration_minutes, timezone, meeting_type, priority, tags, attendees, source, sync_status, source_event_id, source_calendar_id, deal_id, related_contact_id, related_company_id, related_fund_id, objective, agenda, preparation_requirements, preparation_status, followup_status, assigned_copilot_agent, related_record_type, related_record_id, calendar_visibility, reminder_minutes, external_calendar_provider, external_calendar_sync_enabled, external_calendar_sync_status, is_draft, locked_at, updated_at")
    .eq("organization_id", auth.ctx.orgId)
    .is("deleted_at", null)
    .eq("is_draft", false)
    .neq("status", "ended")
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}
