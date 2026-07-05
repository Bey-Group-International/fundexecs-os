import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { deleteMeetingLocal, updateMeeting } from "@/lib/meetings/service";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

function cleanString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  const text = String(value ?? "").trim();
  return text || null;
}

export async function PATCH(request: NextRequest, { params }: { params: Params }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const supabase = await createServerClient();

  try {
    const result = await updateMeeting(
      supabase,
      { orgId: auth.ctx.orgId, userId: auth.ctx.userId },
      id,
      {
        title: body.title === undefined ? undefined : String(body.title),
        description: cleanString(body.description),
        location: cleanString(body.location),
        meetingUrl: cleanString(body.meetingUrl),
        scheduledAt: cleanString(body.scheduledAt),
        durationMinutes: body.durationMinutes === undefined ? undefined : Number(body.durationMinutes),
        timezone: cleanString(body.timezone),
        meetingType: cleanString(body.meetingType),
        priority: body.priority,
        tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
        attendees: Array.isArray(body.attendees) ? body.attendees : undefined,
        relatedContactId: cleanString(body.relatedContactId),
        relatedCompanyId: cleanString(body.relatedCompanyId),
        relatedDealId: cleanString(body.relatedDealId),
        relatedFundId: cleanString(body.relatedFundId),
        syncMode: body.syncMode === "pending_external" ? "pending_external" : "local_only",
      },
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update meeting" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Params }) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const supabase = await createServerClient();

  try {
    return NextResponse.json(await deleteMeetingLocal(supabase, { orgId: auth.ctx.orgId, userId: auth.ctx.userId }, id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete meeting" }, { status: 500 });
  }
}
