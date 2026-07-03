import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { vaultConfigured } from "@/lib/vault";
import { getAppUrl } from "@/lib/integrations/adapters/app-url";
import {
  buildGoogleAuthUrl,
  createOAuthState,
  googleOAuthConfigured,
} from "@/lib/google-oauth";

// GET /api/oauth/google/start — begin the per-org Google connection.
//
// Held to the same admin bar as credential management (the connection decides
// whose Gmail identity the org's outbound mail carries). Mints the signed
// state binding (orgId, userId) and hands the browser to Google's consent
// screen; the callback route does the rest. Every failure path lands back on
// Settings › Integrations with a readable reason — never a bare 500.
export const dynamic = "force-dynamic";

function settingsRedirect(param: string): NextResponse {
  return NextResponse.redirect(`${getAppUrl()}/settings?google=${param}#integrations`);
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
  const redirectUri = `${getAppUrl()}/api/oauth/google/callback`;
  return NextResponse.redirect(buildGoogleAuthUrl(state, redirectUri));
}
