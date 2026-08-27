import { type NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { vaultConfigured } from "@/lib/vault";
import { getAppUrlFromRequest } from "@/lib/integrations/adapters/app-url";
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

function settingsRedirect(base: string, param: string): NextResponse {
  return NextResponse.redirect(`${base}/settings?google=${param}#integrations`);
}

export async function GET(req: NextRequest) {
  // Derived from the request the operator actually made, so an unconfigured
  // deploy sends them back to this site rather than to localhost.
  const base = getAppUrlFromRequest(req);
  const ctx = await getSessionContext();
  if (!ctx?.orgId) {
    return NextResponse.redirect(`${base}/login`);
  }
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return settingsRedirect(base, "forbidden");
  }
  if (!googleOAuthConfigured()) {
    return settingsRedirect(base, "not_configured");
  }
  if (!vaultConfigured()) {
    // Nowhere safe to put the refresh token — refuse before consent, not after.
    return settingsRedirect(base, "vault_not_configured");
  }

  const state = createOAuthState({ orgId: ctx.orgId, userId: ctx.userId });
  const redirectUri = `${base}/api/oauth/google/callback`;
  return NextResponse.redirect(buildGoogleAuthUrl(state, redirectUri));
}
