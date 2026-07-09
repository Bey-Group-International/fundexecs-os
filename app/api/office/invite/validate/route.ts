import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { consumeInviteToken } from "@/lib/office/invite-tokens";

/**
 * Validate and consume a single-use Executive Floor invite token on join.
 *
 * The client posts only the token; the joiner's identity is resolved
 * server-side from the session (never trusted from the client), so a signed-in
 * user can only redeem an invite that was addressed to their email. The token is
 * single-use and expiry-bound. Business outcomes return 200 with `{ ok:false,
 * reason }` so the client can branch without catching non-2xx — `unavailable`
 * (no token backend) tells the client to proceed as a plain shared link.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { token?: string };
  const token = typeof body.token === "string" ? body.token : "";
  if (!token) return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });

  // Server-resolved joiner identity — anonymous guests have no email and bind to
  // the invited address; a real signed-in user must match it.
  let joinerEmail: string | null = null;
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    joinerEmail = user?.email ?? null;
  } catch {
    // Unauthenticated / no Supabase — treat as a guest.
  }

  const result = await consumeInviteToken(token, { joinerEmail });
  return NextResponse.json(result);
}
