import { type NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { encryptSecret, vaultConfigured } from "@/lib/vault";
import { getAppUrlFromRequest } from "@/lib/integrations/adapters/app-url";
import { writeDashboardAudit } from "@/lib/dashboard/audit";
import { GATEWAY_PROVIDER } from "@/lib/integrations/gateway";
import {
  GOOGLE_REFRESH_TOKEN_KEY,
  exchangeCodeForTokens,
  googleOAuthConfigured,
  invalidateGoogleTokenCache,
  verifyOAuthState,
} from "@/lib/google-oauth";

// GET /api/oauth/google/callback — finish the per-org Google connection.
//
// Defense layers, in order: the HMAC-signed state must verify (OAuth CSRF),
// the CALLER'S OWN SESSION must match the org and user the state was minted
// for (a signed state stolen mid-flow still can't attach credentials to
// someone else's org), and the refresh token is written through the
// RLS-enforced client under the caller's session. On success: refresh token
// into the vault, a real integration_connections row labeled with the
// connected Google address, and an integration.connected audit event.
export const dynamic = "force-dynamic";

function settingsRedirect(base: string, param: string): NextResponse {
  return NextResponse.redirect(`${base}/settings?google=${param}#integrations`);
}

export async function GET(req: NextRequest) {
  // Same derivation as /start, so the redirect_uri sent to the token endpoint
  // matches the one consent was granted against.
  const base = getAppUrlFromRequest(req);

  // The user said no on Google's screen — not an error on our side.
  if (req.nextUrl.searchParams.get("error")) {
    return settingsRedirect(base, "denied");
  }

  const code = req.nextUrl.searchParams.get("code");
  const rawState = req.nextUrl.searchParams.get("state");
  if (!code || !rawState) return settingsRedirect(base, "invalid_callback");
  if (!googleOAuthConfigured() || !vaultConfigured()) {
    return settingsRedirect(base, "not_configured");
  }

  const state = verifyOAuthState(rawState);
  if (!state) return settingsRedirect(base, "invalid_state");

  const ctx = await getSessionContext();
  if (!ctx?.orgId || ctx.orgId !== state.orgId || ctx.userId !== state.userId) {
    return settingsRedirect(base, "session_mismatch");
  }
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return settingsRedirect(base, "forbidden");
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, `${base}/api/oauth/google/callback`);
  } catch {
    return settingsRedirect(base, "exchange_failed");
  }
  if (!tokens.refreshToken) {
    // Google only issues a refresh token on a consent-mode grant; without one
    // the connection would silently die in an hour. Ask the user to retry
    // (our /start always sends prompt=consent, so this is a defensive path).
    return settingsRedirect(base, "no_refresh_token");
  }

  const supabase = await createServerClient();

  // 1. Refresh token into the vault (RLS-enforced write under the caller).
  const encrypted = encryptSecret(tokens.refreshToken);
  const { error: secretError } = await supabase.from("org_secrets").upsert(
    {
      organization_id: ctx.orgId,
      provider: GOOGLE_REFRESH_TOKEN_KEY,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      last4: tokens.refreshToken.slice(-4),
      created_by: ctx.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,provider" },
  );
  if (secretError) return settingsRedirect(base, "store_failed");

  // 2. A REAL connection row — the account label is the connected Google
  // address, not the mock's placeholder handle.
  const accountLabel = tokens.email ?? "google-account";
  const { error: connError } = await supabase.from("integration_connections").upsert(
    {
      organization_id: ctx.orgId,
      channel: "gmail",
      status: "connected",
      gateway: GATEWAY_PROVIDER,
      account_label: accountLabel,
      account_ref: `google-oauth:${ctx.orgId}`,
      connected_by: ctx.userId,
      revoked_at: null,
    },
    { onConflict: "organization_id,channel" },
  );
  if (connError) return settingsRedirect(base, "store_failed");

  // A reconnect may be a different Google account; drop any access token
  // cached from the old grant so the next send mints from the new one.
  invalidateGoogleTokenCache(ctx.orgId);

  // 3. Append-only history, same shape as the gateway connect/disconnect path.
  await writeDashboardAudit({
    organizationId: ctx.orgId,
    principalId: ctx.userId,
    action: "integration.connected",
    entityType: "integration_connection",
    afterState: {
      channel: "gmail",
      status: "connected",
      gateway: GATEWAY_PROVIDER,
      account_label: accountLabel,
    },
  });

  return settingsRedirect(base, "connected");
}
