import { type NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { vaultConfigured } from "@/lib/vault";
import { getAppUrlFromRequest } from "@/lib/integrations/adapters/app-url";
import {
  GOOGLE_CALENDAR_SCOPES,
  buildGoogleAuthUrl,
  createOAuthState,
  googleOAuthConfigured,
} from "@/lib/google-oauth";

// GET /api/oauth/google/calendar/start — begin a member's Google Calendar
// connection.
//
// Mirrors the Gmail and People /start routes, with one deliberate difference:
// no admin bar. Those grants are org-level — an admin decides the org's
// outbound mailbox and contacts import. A calendar is personal, so any member
// connects their own, and nobody can connect on someone else's behalf.
//
// Every failure path returns to the meetings page with a readable reason rather
// than a bare 500.
export const dynamic = "force-dynamic";

function back(base: string, param: string): NextResponse {
  return NextResponse.redirect(`${base}/meetings?google_calendar=${param}`);
}

export async function GET(req: NextRequest) {
  const base = getAppUrlFromRequest(req);
  const ctx = await getSessionContext();
  if (!ctx?.userId) {
    return NextResponse.redirect(`${base}/login`);
  }
  if (!googleOAuthConfigured()) {
    return back(base, "not_configured");
  }
  if (!vaultConfigured()) {
    // Nowhere safe to put the refresh token — refuse before consent, not after.
    return back(base, "vault_not_configured");
  }

  const state = createOAuthState({ orgId: ctx.orgId ?? "", userId: ctx.userId });
  const redirectUri = `${base}/api/oauth/google/calendar/callback`;
  return NextResponse.redirect(buildGoogleAuthUrl(state, redirectUri, GOOGLE_CALENDAR_SCOPES));
}
