import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { vaultConfigured } from "@/lib/vault";
import { getAppUrl } from "@/lib/integrations/adapters/app-url";
import {
  buildCartaAuthUrl,
  createCartaOAuthState,
  createPkcePair,
  cartaAuthConfigured,
  resolveClientCreds,
  CARTA_CALLBACK_PATH,
  CARTA_PKCE_COOKIE,
  CARTA_OAUTH_SCOPES_ENV,
} from "@/lib/integrations/carta/oauth.server";

// GET /api/oauth/carta/start — begin the interactive Carta connection
// (authorization_code + PKCE). This is the fallback for Carta plans that expose
// only interactive/third-party consent rather than client_credentials.
//
// Held to the same admin bar as credential management. Mints a signed state
// (orgId, userId, expiry) and a PKCE verifier (stashed in an httpOnly cookie),
// then hands the browser to Carta's consent screen. Every failure lands back on
// Settings › Integrations with a readable reason — never a bare 500.
export const dynamic = "force-dynamic";

function settingsRedirect(param: string): NextResponse {
  return NextResponse.redirect(`${getAppUrl()}/settings?carta=${param}#integrations`);
}

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return NextResponse.redirect(`${getAppUrl()}/login`);
  if (ctx.role !== "owner" && ctx.role !== "admin") return settingsRedirect("forbidden");
  if (!vaultConfigured()) return settingsRedirect("vault_not_configured");
  if (!cartaAuthConfigured()) return settingsRedirect("not_configured");

  // The confidential client id/secret must exist before we start (the callback
  // needs the secret to exchange the code). Refuse before consent, not after.
  const creds = await resolveClientCreds(ctx.orgId);
  if (!creds) return settingsRedirect("missing_client_credentials");

  const { verifier, challenge } = createPkcePair();
  const state = createCartaOAuthState({ orgId: ctx.orgId, userId: ctx.userId });
  const redirectUri = `${getAppUrl()}${CARTA_CALLBACK_PATH}`;

  const url = buildCartaAuthUrl({
    clientId: creds.clientId,
    redirectUri,
    state,
    codeChallenge: challenge,
    scope: process.env[CARTA_OAUTH_SCOPES_ENV] || undefined,
  });

  const res = NextResponse.redirect(url);
  // Verifier stays server-side (httpOnly), scoped to the callback path, short
  // TTL, Lax so it survives the top-level redirect back from Carta.
  res.cookies.set(CARTA_PKCE_COOKIE, verifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: CARTA_CALLBACK_PATH,
    maxAge: 600,
  });
  return res;
}
