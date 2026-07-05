import { type NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { encryptSecret, vaultConfigured } from "@/lib/vault";
import { getAppUrl } from "@/lib/integrations/adapters/app-url";
import { writeDashboardAudit } from "@/lib/dashboard/audit";
import {
  GOOGLE_PEOPLE_REFRESH_TOKEN_KEY,
  exchangeCodeForTokens,
  googleOAuthConfigured,
  invalidateGooglePeopleTokenCache,
  verifyOAuthState,
} from "@/lib/google-oauth";

// GET /api/oauth/google/people/callback — finish the per-org Google Contacts
// connection.
//
// Same defense layers as the Gmail callback: the HMAC-signed state must verify
// (OAuth CSRF), the caller's own session must match the org+user the state was
// minted for, and the refresh token is written through the RLS-enforced client
// under the caller's session. The token is stored under a DISTINCT vault key
// (GOOGLE_PEOPLE_REFRESH_TOKEN) so it coexists with the Gmail refresh token
// rather than overwriting it. Never logs or returns the token itself.
export const dynamic = "force-dynamic";

function settingsRedirect(param: string): NextResponse {
  return NextResponse.redirect(`${getAppUrl()}/settings?google_people=${param}#integrations`);
}

export async function GET(req: NextRequest) {
  // The user said no on Google's screen — not an error on our side.
  if (req.nextUrl.searchParams.get("error")) {
    return settingsRedirect("denied");
  }

  const code = req.nextUrl.searchParams.get("code");
  const rawState = req.nextUrl.searchParams.get("state");
  if (!code || !rawState) return settingsRedirect("invalid_callback");
  if (!googleOAuthConfigured() || !vaultConfigured()) {
    return settingsRedirect("not_configured");
  }

  const state = verifyOAuthState(rawState);
  if (!state) return settingsRedirect("invalid_state");

  const ctx = await getSessionContext();
  if (!ctx?.orgId || ctx.orgId !== state.orgId || ctx.userId !== state.userId) {
    return settingsRedirect("session_mismatch");
  }
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return settingsRedirect("forbidden");
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, `${getAppUrl()}/api/oauth/google/people/callback`);
  } catch {
    return settingsRedirect("exchange_failed");
  }
  if (!tokens.refreshToken) {
    // Google only issues a refresh token on a consent-mode grant; without one
    // the connection would silently die in an hour. Our /start always sends
    // prompt=consent, so this is a defensive path — ask the user to retry.
    return settingsRedirect("no_refresh_token");
  }

  const supabase = await createServerClient();

  // People refresh token into the vault under its own key (RLS-enforced write).
  const encrypted = encryptSecret(tokens.refreshToken);
  const { error: secretError } = await supabase.from("org_secrets").upsert(
    {
      organization_id: ctx.orgId,
      provider: GOOGLE_PEOPLE_REFRESH_TOKEN_KEY,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      last4: tokens.refreshToken.slice(-4),
      created_by: ctx.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,provider" },
  );
  if (secretError) return settingsRedirect("store_failed");

  // A reconnect may be a different Google account; drop any People access token
  // cached from the old grant so the next sync mints from the new one.
  invalidateGooglePeopleTokenCache(ctx.orgId);

  // Append-only history, same shape as the Gmail connect path.
  await writeDashboardAudit({
    organizationId: ctx.orgId,
    principalId: ctx.userId,
    action: "integration.connected",
    entityType: "integration_connection",
    afterState: {
      channel: "google_contacts",
      status: "connected",
      account_label: tokens.email ?? "google-account",
    },
  });

  return settingsRedirect("connected");
}
