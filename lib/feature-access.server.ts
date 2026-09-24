// lib/feature-access.server.ts
// Resolving the caller's position against the plan gate (see lib/feature-access).
//
// Every server action and API route in a gated area calls requireFeatureAccess
// before it does anything: the pages stay browsable, so this server-side check
// is what actually holds the gate.
import { getSessionContext, type SessionContext } from "@/lib/auth";
import { getWallet } from "@/lib/wallet";
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
  // An admin never needs the wallet read.
  const wallet = !admin && ctx.orgId ? await getWallet(ctx.orgId) : null;
  return evaluateFeatureAccess({ isPlatformAdmin: admin, plan: wallet?.plan ?? null });
}

/** The current session's feature access; locked when there is no session. */
export async function currentFeatureAccess(): Promise<FeatureAccess> {
  const ctx = await getSessionContext();
  if (!ctx) return { unlocked: false, viaAdmin: false, plan: null };
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
