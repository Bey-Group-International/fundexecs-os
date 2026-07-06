import { type NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { encryptSecret, vaultConfigured } from "@/lib/vault";
import { getAppUrl } from "@/lib/integrations/adapters/app-url";
import { writeDashboardAudit } from "@/lib/dashboard/audit";
import {
  CARTA_CALLBACK_PATH,
  CARTA_PKCE_COOKIE,
  CARTA_REFRESH_TOKEN_SECRET,
  cartaAuthConfigured,
  exchangeCartaCode,
  resolveCartaEndpoints,
  resolveClientCreds,
  verifyCartaOAuthState,
  invalidateCartaTokenCache,
} from "@/lib/integrations/carta/oauth.server";

// GET /api/oauth/carta/callback — finish the interactive Carta connection.
//
// Defense layers, in order: the HMAC-signed state must verify (OAuth CSRF); the
// CALLER'S OWN SESSION must match the org+user the state was minted for (a
// stolen state still can't attach credentials elsewhere); the PKCE verifier
// cookie must be present and is sent with the code exchange (auth-code
// interception protection); the caller must be owner/admin; and the refresh
// token is written through the RLS-enforced client under the caller's session.
export const dynamic = "force-dynamic";

function settingsRedirect(param: string): NextResponse {
  const res = NextResponse.redirect(`${getAppUrl()}/settings?carta=${param}#integrations`);
  // Always clear the one-shot PKCE cookie on the way out.
  res.cookies.set(CARTA_PKCE_COOKIE, "", { path: CARTA_CALLBACK_PATH, maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("error")) return settingsRedirect("denied");

  const code = req.nextUrl.searchParams.get("code");
  const rawState = req.nextUrl.searchParams.get("state");
  if (!code || !rawState) return settingsRedirect("invalid_callback");
  if (!cartaAuthConfigured() || !vaultConfigured()) return settingsRedirect("not_configured");

  const state = verifyCartaOAuthState(rawState);
  if (!state) return settingsRedirect("invalid_state");

  const ctx = await getSessionContext();
  if (!ctx?.orgId || ctx.orgId !== state.orgId || ctx.userId !== state.userId) {
    return settingsRedirect("session_mismatch");
  }
  if (ctx.role !== "owner" && ctx.role !== "admin") return settingsRedirect("forbidden");

  const verifier = req.cookies.get(CARTA_PKCE_COOKIE)?.value;
  if (!verifier) return settingsRedirect("pkce_missing");

  const creds = await resolveClientCreds(ctx.orgId);
  if (!creds) return settingsRedirect("missing_client_credentials");

  // Token endpoint: manual (CARTA_TOKEN_URL) or discovered from CARTA_MCP_URL.
  const endpoints = await resolveCartaEndpoints();
  if (!endpoints?.tokenEndpoint) return settingsRedirect("discovery_failed");

  let tokens;
  try {
    tokens = await exchangeCartaCode({
      code,
      codeVerifier: verifier,
      redirectUri: `${getAppUrl()}${CARTA_CALLBACK_PATH}`,
      tokenUrl: endpoints.tokenEndpoint,
      creds,
    });
  } catch {
    return settingsRedirect("exchange_failed");
  }
  if (!tokens.refreshToken) {
    // Without a refresh token the connection would silently die at the access
    // token's expiry — surface it rather than storing a dead connection.
    return settingsRedirect("no_refresh_token");
  }

  // Refresh token → vault (RLS-enforced write under the caller's session).
  const supabase = await createServerClient();
  const enc = encryptSecret(tokens.refreshToken);
  const { error: secretError } = await supabase.from("org_secrets").upsert(
    {
      organization_id: ctx.orgId,
      provider: CARTA_REFRESH_TOKEN_SECRET,
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      auth_tag: enc.authTag,
      last4: tokens.refreshToken.slice(-4),
      created_by: ctx.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,provider" },
  );
  if (secretError) return settingsRedirect("store_failed");

  // A reconnect may be a different Carta grant; drop any cached access token so
  // the next sweep mints from the new refresh token.
  invalidateCartaTokenCache(ctx.orgId);

  await writeDashboardAudit({
    organizationId: ctx.orgId,
    principalId: ctx.userId,
    action: "integration.connected",
    entityType: "integration_connection",
    afterState: { channel: "carta", status: "connected", grant: "authorization_code" },
  });

  return settingsRedirect("connected");
}
