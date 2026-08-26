import { type NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { vaultConfigured } from "@/lib/vault";
import { getAppUrl } from "@/lib/integrations/adapters/app-url";
import {
  exchangeCodeForTokens,
  googleOAuthConfigured,
  verifyOAuthState,
} from "@/lib/google-oauth";
import { sealRefreshToken } from "@/lib/calendar/google.server";

// GET /api/oauth/google/calendar/callback — finish a member's Google Calendar
// connection.
//
// Same defense layers as the Gmail and People callbacks: the HMAC-signed state
// must verify (OAuth CSRF), and the caller's own session must match the user
// the state was minted for. Unlike those two there is no admin bar — a calendar
// is personal, and the grant is stored against the connecting member.
//
// The refresh token never reaches a log or a response body. It is encrypted
// with the same AES-256-GCM helpers as org_secrets and written through the
// RLS-enforced client under the caller's session, so the row can only land on
// their own user_id.
export const dynamic = "force-dynamic";

function back(param: string): NextResponse {
  return NextResponse.redirect(`${getAppUrl()}/meetings?google_calendar=${param}`);
}

export async function GET(req: NextRequest) {
  // The member said no on Google's screen — not an error on our side.
  if (req.nextUrl.searchParams.get("error")) return back("denied");

  const code = req.nextUrl.searchParams.get("code");
  const rawState = req.nextUrl.searchParams.get("state");
  if (!code || !rawState) return back("invalid_callback");
  if (!googleOAuthConfigured() || !vaultConfigured()) return back("not_configured");

  const state = verifyOAuthState(rawState);
  if (!state) return back("invalid_state");

  const ctx = await getSessionContext();
  if (!ctx?.userId || ctx.userId !== state.userId) return back("session_mismatch");

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, `${getAppUrl()}/api/oauth/google/calendar/callback`);
  } catch {
    return back("exchange_failed");
  }

  // Google withholds the refresh token when the member has already granted this
  // scope and did not re-consent. Without it there is nothing durable to store,
  // so say so rather than saving a connection that dies in an hour.
  if (!tokens.refreshToken) return back("no_refresh_token");

  try {
    const supabase = await createServerClient();
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("google_calendar_connections")
      .upsert(
        {
          user_id: ctx.userId,
          organization_id: ctx.orgId ?? null,
          google_email: tokens.email,
          ...sealRefreshToken(tokens.refreshToken),
          connected_at: now,
          // A reconnection is how a member fixes a revoked grant, so the old
          // failure state must not survive it and keep the UI red.
          last_error: null,
          consecutive_failures: 0,
          updated_at: now,
        } as never,
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error("[/api/oauth/google/calendar/callback]", err);
    return back("save_failed");
  }

  return back("connected");
}
