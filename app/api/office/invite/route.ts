import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { sendFloorInvites } from "@/lib/office/floor-invite";

/**
 * Email an Executive Floor invite. Sends server-side through the app's mailer
 * (no external client / mailto) with a link that opens the spatial office floor,
 * so guests join the operator's in-office meeting.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    emails?: string[];
    room?: string | null;
    meet?: boolean;
    deal?: string | null;
  };
  if (!Array.isArray(body.emails) || body.emails.length === 0) {
    return NextResponse.json({ error: "emails required" }, { status: 400 });
  }

  // Best-effort inviter attribution recorded on each minted token. principals.id
  // is the auth user id; the org is the caller's first membership.
  let organizationId: string | null = null;
  try {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("principal_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    organizationId = membership?.organization_id ?? null;
  } catch {
    // Non-fatal — the token still works without org attribution.
  }

  const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  const { sent, total } = await sendFloorInvites({
    origin,
    senderName: user.email ?? "Someone",
    emails: body.emails,
    room: typeof body.room === "string" ? body.room : null,
    meet: body.meet === true,
    deal: typeof body.deal === "string" ? body.deal : null,
    inviterId: user.id,
    inviterEmail: user.email ?? null,
    organizationId,
  });

  return NextResponse.json({ ok: true, sent, total });
}
