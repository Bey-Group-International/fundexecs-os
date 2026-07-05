import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { vaultConfigured } from "@/lib/vault";
import { getAppUrl } from "@/lib/integrations/adapters/app-url";
import {
  GOOGLE_PEOPLE_SCOPES,
  buildGoogleAuthUrl,
  createOAuthState,
  googleOAuthConfigured,
} from "@/lib/google-oauth";

// GET /api/oauth/google/people/start — begin the per-org Google Contacts
// (People API) connection.
//
// Mirrors the Gmail /start route but requests the contacts.readonly scope and
// lands on the People callback, so the Contacts grant is a DISTINCT flow that
// never disturbs the Gmail scope or refresh token. Same admin bar (the
// connection decides whose contacts the org imports) and the same signed-state
// CSRF protection. Every failure path returns to Settings › Integrations with a
// readable reason — never a bare 500.
export const dynamic = "force-dynamic";

function settingsRedirect(param: string): NextResponse {
  return NextResponse.redirect(`${getAppUrl()}/settings?google_people=${param}#integrations`);
}

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) {
    return NextResponse.redirect(`${getAppUrl()}/login`);
  }
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return settingsRedirect("forbidden");
  }
  if (!googleOAuthConfigured()) {
    return settingsRedirect("not_configured");
  }
  if (!vaultConfigured()) {
    // Nowhere safe to put the refresh token — refuse before consent, not after.
    return settingsRedirect("vault_not_configured");
  }

  const state = createOAuthState({ orgId: ctx.orgId, userId: ctx.userId });
  const redirectUri = `${getAppUrl()}/api/oauth/google/people/callback`;
  return NextResponse.redirect(buildGoogleAuthUrl(state, redirectUri, GOOGLE_PEOPLE_SCOPES));
}
