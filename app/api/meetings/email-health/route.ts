import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { getEmailConfigStatus, sendEmail } from "@/lib/email";
import { buildMeetingInviteHtml } from "@/lib/meetings/invite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET — report whether this org's mailbox is connected (no secrets exposed) so
// an operator can confirm meeting invites will actually deliver.
export async function GET() {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json(await getEmailConfigStatus(auth.ctx.orgId));
}

// POST — send a real test invite email to the signed-in user's OWN address
// (never an arbitrary recipient), so delivery can be confirmed end-to-end.
export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const status = await getEmailConfigStatus(auth.ctx.orgId);
  if (!status.willAttemptSend) {
    return NextResponse.json(
      { ok: false, error: "No mailbox is connected for this organization.", status },
      { status: 409 },
    );
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const email = user?.email;
  if (!email) {
    return NextResponse.json({ error: "No email on your account to send the test to." }, { status: 400 });
  }

  const origin = req.nextUrl.origin;
  const result = await sendEmail({
    orgId: auth.ctx.orgId,
    to: { name: email.split("@")[0] ?? email, email },
    subject: "FundExecs OS — meeting invite email test",
    htmlBody: buildMeetingInviteHtml({
      inviteUrl: `${origin}/meetings`,
      title: "Email delivery test",
      senderName: email,
    }),
  });

  return NextResponse.json({
    ok: result.ok,
    sentTo: email,
    provider: result.channel,
    detail: result.detail,
    status,
  });
}
