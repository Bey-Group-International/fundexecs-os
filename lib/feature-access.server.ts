// lib/feature-access.server.ts
// Resolving the caller's position against the plan gate (see lib/feature-access).
//
// Every server action and API route in a gated area calls requireFeatureAccess
// before it does anything: the pages stay browsable, so this server-side check
// is what actually holds the gate.
import { getSessionContext, type SessionContext } from "@/lib/auth";
import { getWallet } from "@/lib/wallet";
import { createServerClient, type createServiceClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/platform-admin";
import {
  evaluateFeatureAccess,
  featureLockedMessage,
  type FeatureAccess,
  type GatedFeature,
} from "@/lib/feature-access";

/** The caller's feature access, given an already-resolved session. */
export async function featureAccessFor(ctx: SessionContext): Promise<FeatureAccess> {
  const admin = isPlatformAdmin(ctx);
  // An admin never needs the wallet or org read.
  if (admin || !ctx.orgId) {
    return evaluateFeatureAccess({ isPlatformAdmin: admin, plan: null, orgCreatedAt: null });
  }
  const [wallet, orgCreatedAt] = await Promise.all([getWallet(ctx.orgId), orgCreatedAtFor(ctx.orgId)]);
  return evaluateFeatureAccess({ isPlatformAdmin: false, plan: wallet?.plan ?? null, orgCreatedAt });
}

async function orgCreatedAtFor(orgId: string): Promise<string | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("organizations")
    .select("created_at")
    .eq("id", orgId)
    .maybeSingle();
  return (data as { created_at?: string | null } | null)?.created_at ?? null;
}

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Feature access for work that runs without a session (the cron sweep), on the
 * service-role client. `actorId` is the principal the work runs as: when that
 * principal is a platform admin the work is unrestricted, exactly as it would be
 * if they were signed in.
 */
export async function featureAccessForOrg(
  service: ServiceClient,
  orgId: string,
  actorId: string | null,
): Promise<FeatureAccess> {
  if (actorId) {
    const { data } = await service.auth.admin.getUserById(actorId);
    const user = data?.user;
    if (user && isPlatformAdmin({ email: user.email, emailConfirmed: Boolean(user.email_confirmed_at) })) {
      return evaluateFeatureAccess({ isPlatformAdmin: true, plan: null, orgCreatedAt: null });
    }
  }
  const [walletRes, orgRes] = await Promise.all([
    service.from("wallets").select("plan").eq("organization_id", orgId).maybeSingle(),
    service.from("organizations").select("created_at").eq("id", orgId).maybeSingle(),
  ]);
  return evaluateFeatureAccess({
    isPlatformAdmin: false,
    plan: (walletRes.data as { plan?: string | null } | null)?.plan ?? null,
    orgCreatedAt: (orgRes.data as { created_at?: string | null } | null)?.created_at ?? null,
  });
}

/** The current session's feature access; locked when there is no session. */
export async function currentFeatureAccess(): Promise<FeatureAccess> {
  const ctx = await getSessionContext();
  if (!ctx) return { unlocked: false, viaAdmin: false, grandfathered: false, plan: null };
  return featureAccessFor(ctx);
}

export type FeatureGate =
  | { ok: true }
  | { ok: false; status: 401 | 402; error: string };

/**
 * Confirm the caller may act in `feature`. 401 when signed out, 402 when the org
 * has no paid plan. The error string is safe to show the user as-is.
 */
export async function requireFeatureAccess(feature: GatedFeature): Promise<FeatureGate> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, status: 401, error: "Not authenticated" };
  const access = await featureAccessFor(ctx);
  if (access.unlocked) return { ok: true };
  return { ok: false, status: 402, error: featureLockedMessage(feature) };
}
