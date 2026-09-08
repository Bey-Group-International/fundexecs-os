import { type NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { vaultConfigured } from "@/lib/vault";
import { getAppUrlFromRequest } from "@/lib/integrations/adapters/app-url";
import {
  exchangeCodeForTokens,
  googleOAuthConfigured,
  verifyOAuthState,
} from "@/lib/google-oauth";
import { sealRefreshToken, syncStaleGoogleConnections } from "@/lib/calendar/google.server";

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
// The first sync runs inside this request (see below), so the default request
// ceiling is too tight for a member with several calendars.
export const maxDuration = 60;

/**
 * How long the first sync may take before the member is sent on with whatever
 * it managed to read. Well inside `maxDuration`, so the redirect always happens
 * rather than the connection dying at the platform's timeout with the member
 * looking at an error page for something that actually worked.
 */
const FIRST_SYNC_BUDGET_MS = 20_000;

function back(base: string, param: string): NextResponse {
  return NextResponse.redirect(`${base}/meetings?google_calendar=${param}`);
}

export async function GET(req: NextRequest) {
  // Same derivation as /start, so the redirect_uri sent to the token endpoint
  // matches the one consent was granted against.
  const base = getAppUrlFromRequest(req);

  // The member said no on Google's screen — not an error on our side.
  if (req.nextUrl.searchParams.get("error")) return back(base, "denied");

  const code = req.nextUrl.searchParams.get("code");
  const rawState = req.nextUrl.searchParams.get("state");
  if (!code || !rawState) return back(base, "invalid_callback");
  if (!googleOAuthConfigured() || !vaultConfigured()) return back(base, "not_configured");

  const state = verifyOAuthState(rawState);
  if (!state) return back(base, "invalid_state");

  const ctx = await getSessionContext();
  if (!ctx?.userId || ctx.userId !== state.userId) return back(base, "session_mismatch");

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, `${base}/api/oauth/google/calendar/callback`);
  } catch {
    return back(base, "exchange_failed");
  }

  // Google withholds the refresh token when the member has already granted this
  // scope and did not re-consent. Without it there is nothing durable to store,
  // so say so rather than saving a connection that dies in an hour.
  if (!tokens.refreshToken) return back(base, "no_refresh_token");

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
          // What Google actually granted, which is not always what was asked
          // for. Read back before every send: without it stored, a grant that
          // covers sending is indistinguishable from one that does not.
          granted_scope: tokens.scope,
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
    return back(base, "save_failed");
  }

  // Pull the calendars and events now, before redirecting.
  //
  // Until this ran, connecting Google produced a success banner and an entirely
  // empty calendar: `google_calendars` and `external_events` are written only
  // by the hourly cron sweep, so the rail had no layers and the grid had no
  // events until the top of the hour — and nothing at all where CRON_SECRET is
  // unset. A member who has just authorized their calendar and is looking at
  // none of it has no way to tell a working connection from a broken one.
  //
  // Best-effort on purpose: the grant is already saved and valid. A sync that
  // fails or runs out of budget here is something the sweep will finish, so it
  // must not turn a successful connection into an error the member has to
  // redo. Scoped to this member and run under their own session — RLS on all
  // three tables is owner-based, so the rows can only land on their user_id.
  let synced = false;
  try {
    const supabase = await createServerClient();
    const result = await syncStaleGoogleConnections(supabase, {
      userId: ctx.userId,
      budgetMs: FIRST_SYNC_BUDGET_MS,
    });
    synced = result.connections > 0 && result.failed === 0 && !result.incomplete;
  } catch (err) {
    console.error("[/api/oauth/google/calendar/callback] first sync", err);
  }

  // Two outcomes, because they need different words: a calendar that is ready
  // to look at, and one that is still filling in. Saying "connected" over an
  // empty grid is the confusion this whole block exists to remove.
  return back(base, synced ? "connected" : "connected_syncing");
}
