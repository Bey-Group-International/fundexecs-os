import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { encryptSecret, vaultConfigured } from "@/lib/vault";
import { getAppUrl } from "@/lib/integrations/adapters/app-url";
import { registerDynamicClient } from "@/lib/integrations/carta/discovery.server";
import {
  buildCartaAuthUrl,
  createCartaOAuthState,
  createPkcePair,
  cartaAuthConfigured,
  resolveCartaEndpoints,
  resolveClientCreds,
  CARTA_CALLBACK_PATH,
  CARTA_PKCE_COOKIE,
  CARTA_DCR_CLIENT_ID_SECRET,
  CARTA_DCR_CLIENT_SECRET_SECRET,
  CARTA_OAUTH_SCOPES_ENV,
  type CartaClientCreds,
} from "@/lib/integrations/carta/oauth.server";

// GET /api/oauth/carta/start — begin the interactive Carta connection
// (authorization_code + PKCE). Endpoints come from CARTA_AUTHORIZE_URL/
// CARTA_TOKEN_URL if set, otherwise DISCOVERED from CARTA_MCP_URL (RFC 8414/9728).
// If the org has no client credentials, the app DYNAMICALLY REGISTERS one
// (RFC 7591) against the discovered registration endpoint and stores it in the
// vault — the no-credentials path. The operator then just consents.
//
// Held to the same admin bar as credential management. Every failure lands back
// on Settings › Integrations with a readable reason — never a bare 500.
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

  const endpoints = await resolveCartaEndpoints();
  if (!endpoints?.authorizationEndpoint) return settingsRedirect("discovery_failed");

  const redirectUri = `${getAppUrl()}${CARTA_CALLBACK_PATH}`;

  // Resolve client creds; dynamically register one if the org has none and the
  // server advertises a registration endpoint (the no-manual-credentials path).
  let creds: CartaClientCreds | null = await resolveClientCreds(ctx.orgId);
  if (!creds && endpoints.registrationEndpoint) {
    const registered = await registerDynamicClient(endpoints.registrationEndpoint, redirectUri);
    if (registered) {
      const supabase = await createServerClient();
      const rows = [
        { provider: CARTA_DCR_CLIENT_ID_SECRET, value: registered.clientId },
        ...(registered.clientSecret
          ? [{ provider: CARTA_DCR_CLIENT_SECRET_SECRET, value: registered.clientSecret }]
          : []),
      ];
      for (const row of rows) {
        const enc = encryptSecret(row.value);
        await supabase.from("org_secrets").upsert(
          {
            organization_id: ctx.orgId,
            provider: row.provider,
            ciphertext: enc.ciphertext,
            iv: enc.iv,
            auth_tag: enc.authTag,
            last4: row.value.slice(-4),
            created_by: ctx.userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id,provider" },
        );
      }
      creds = { clientId: registered.clientId, clientSecret: registered.clientSecret };
    }
  }
  if (!creds) return settingsRedirect("missing_client_credentials");

  const { verifier, challenge } = createPkcePair();
  const state = createCartaOAuthState({ orgId: ctx.orgId, userId: ctx.userId });
  const scope = process.env[CARTA_OAUTH_SCOPES_ENV] || endpoints.scopesSupported?.join(" ") || undefined;

  const url = buildCartaAuthUrl({
    clientId: creds.clientId,
    redirectUri,
    state,
    codeChallenge: challenge,
    scope,
    authorizeUrl: endpoints.authorizationEndpoint,
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
