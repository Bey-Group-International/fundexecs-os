// Gift Earn data access + mutations: referral codes, the downline summary, code
// redemption and the multi-level reward payout, and purchased credit gifts.
//
// Reads that must traverse OTHER orgs (a downline spans organizations the caller
// is not a member of) and all reward writes use the service-role client; they're
// always scoped by an orgId we derive from the authenticated session, never from
// client input.
import { randomInt } from "crypto";
import { createServiceClient, createServerClient } from "@/lib/supabase/server";
import { grantCredits } from "@/lib/credits";
import { CREDIT_PACKS } from "@/lib/billing";
import {
  REFERRAL_WELCOME_BONUS,
  MAX_LEVEL,
  directReward,
  levelOverride,
  milestoneAt,
  isReferralEarning,
} from "@/lib/referrals";
import type { CreditGift } from "@/lib/supabase/database.types";

type ServiceClient = ReturnType<typeof createServiceClient>;

// Unambiguous code alphabet (no 0/O/1/I) for share links people may type.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// Codes gate a financial reward (credits), so draw from a CSPRNG rather than
// Math.random() — an attacker should not be able to predict or enumerate them.
function randomCode(len = 8): string {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

// The org's shareable referral code, created on first read. Idempotent under the
// org-unique constraint, so a race just returns the existing code. Returns null
// (never throws) if it can't be read or allocated — e.g. the table isn't
// migrated yet or the service role isn't configured — so callers can degrade
// gracefully instead of crashing the page.
export async function getOrCreateReferralCode(
  orgId: string,
  createdBy: string | null,
): Promise<string | null> {
  try {
    const supabase = await createServerClient();
    const { data: existing } = await supabase
      .from("referral_codes")
      .select("code")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (existing?.code) return existing.code;

    const service = createServiceClient();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      const { error } = await service
        .from("referral_codes")
        .insert({ organization_id: orgId, code, created_by: createdBy });
      if (!error) return code;
      // Either the org already has a code (unique org) or the code collided.
      const { data } = await service
        .from("referral_codes")
        .select("code")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (data?.code) return data.code;
    }
    return null;
  } catch (err) {
    console.error("[gift-earn] getOrCreateReferralCode failed:", err);
    return null;
  }
}

export interface DownlineRow {
  orgId: string;
  name: string;
  status: string;
  createdAt: string;
  level: number;
}

export interface ReferralSummary {
  directCount: number;
  totalDownline: number;
  levelCounts: Record<number, number>;
  downline: DownlineRow[];
  earnedTotal: number;
}

// Walk DOWN the referral forest from `orgId` to MAX_LEVEL, with org names and
// total referral earnings from the ledger. Uses the service client because the
// downline crosses orgs the caller can't read under RLS.
const EMPTY_SUMMARY: ReferralSummary = {
  directCount: 0,
  totalDownline: 0,
  levelCounts: {},
  downline: [],
  earnedTotal: 0,
};

export async function getReferralSummary(orgId: string): Promise<ReferralSummary> {
  try {
    return await computeReferralSummary(orgId);
  } catch (err) {
    console.error("[gift-earn] getReferralSummary failed:", err);
    return EMPTY_SUMMARY;
  }
}

async function computeReferralSummary(orgId: string): Promise<ReferralSummary> {
  const service = createServiceClient();
  const downline: DownlineRow[] = [];
  const levelCounts: Record<number, number> = {};
  let frontier = [orgId];

  for (let level = 1; level <= MAX_LEVEL && frontier.length > 0; level++) {
    const { data: edges } = await service
      .from("referrals")
      .select("referred_organization_id, status, created_at")
      .in("referrer_organization_id", frontier);
    const rows = edges ?? [];
    if (rows.length === 0) break;

    const ids = rows.map((r) => r.referred_organization_id);
    const { data: orgs } = await service.from("organizations").select("id, name").in("id", ids);
    const nameById = new Map((orgs ?? []).map((o) => [o.id, o.name]));

    for (const r of rows) {
      downline.push({
        orgId: r.referred_organization_id,
        name: nameById.get(r.referred_organization_id) ?? "An organization",
        status: r.status,
        createdAt: r.created_at,
        level,
      });
    }
    levelCounts[level] = rows.length;
    frontier = ids;
  }

  const { data: ledger } = await service
    .from("credit_ledger")
    .select("amount, reason")
    .eq("organization_id", orgId);
  const earnedTotal = (ledger ?? [])
    .filter((e) => isReferralEarning(e.reason))
    .reduce((sum, e) => sum + e.amount, 0);

  return {
    directCount: levelCounts[1] ?? 0,
    totalDownline: downline.length,
    levelCounts,
    downline,
    earnedTotal,
  };
}

export interface RedeemReferralResult {
  ok: boolean;
  error?: string;
  welcome?: number;
}

// Record that `joiningOrgId` was referred by `code`'s owner, credit the welcome
// bonus, and pay the upline. Guards against self-referral, double-redemption,
// and referral loops.
export async function redeemReferralCode(
  code: string,
  joiningOrgId: string,
): Promise<RedeemReferralResult> {
  const clean = code.trim().toUpperCase();
  if (!clean) return { ok: false, error: "Enter a referral code." };

  const service = createServiceClient();
  const { data: codeRow } = await service
    .from("referral_codes")
    .select("organization_id")
    .eq("code", clean)
    .maybeSingle();
  if (!codeRow) return { ok: false, error: "That referral code doesn't exist." };

  const referrerOrgId = codeRow.organization_id;
  if (referrerOrgId === joiningOrgId)
    return { ok: false, error: "You can't refer your own organization." };

  const { data: already } = await service
    .from("referrals")
    .select("id")
    .eq("referred_organization_id", joiningOrgId)
    .maybeSingle();
  if (already)
    return { ok: false, error: "Your organization has already redeemed a referral." };

  // Cycle guard: walk UP from the referrer; if we reach the joining org, the new
  // edge would close a loop.
  let cursor: string | null = referrerOrgId;
  for (let i = 0; i < 50 && cursor; i++) {
    const node: string = cursor;
    if (node === joiningOrgId)
      return { ok: false, error: "That would create a referral loop." };
    const upRes = await service
      .from("referrals")
      .select("referrer_organization_id")
      .eq("referred_organization_id", node)
      .maybeSingle();
    cursor = (upRes.data?.referrer_organization_id as string | undefined) ?? null;
  }

  const { error: insErr } = await service.from("referrals").insert({
    referrer_organization_id: referrerOrgId,
    referred_organization_id: joiningOrgId,
    code: clean,
    status: "joined",
  });
  if (insErr) return { ok: false, error: insErr.message };

  await grantCredits(service, joiningOrgId, REFERRAL_WELCOME_BONUS, "referral_welcome", {
    sourceOrgId: referrerOrgId,
    note: "Welcome bonus",
  });
  await awardReferralChain(service, joiningOrgId);

  return { ok: true, welcome: REFERRAL_WELCOME_BONUS };
}

// Auto-claim a referral code at org-creation time (called from onboarding).
// Records the edge as 'pending' and grants the welcome bonus, but does NOT yet
// pay the referrer chain — that fires at first paid-plan activation via
// awardReferralOnSubscription(). This is intentionally best-effort: errors are
// returned as a string so the caller can decide whether to surface or swallow.
export async function claimReferralCode(
  code: string,
  joiningOrgId: string,
): Promise<string | null> {
  const clean = code.trim().toUpperCase();
  if (!clean) return null;

  const service = createServiceClient();

  const { data: codeRow } = await service
    .from("referral_codes")
    .select("organization_id")
    .eq("code", clean)
    .maybeSingle();
  if (!codeRow) return "Referral code not found.";

  const referrerOrgId = codeRow.organization_id;
  if (referrerOrgId === joiningOrgId) return null; // silent self-referral skip

  const { data: already } = await service
    .from("referrals")
    .select("id")
    .eq("referred_organization_id", joiningOrgId)
    .maybeSingle();
  if (already) return null; // already referred — no action, no error

  // Cycle guard (mirror the typed-node pattern in redeemReferralCode to avoid
  // implicit-any on the Supabase query builder's return type).
  let cursor: string | null = referrerOrgId;
  for (let i = 0; i < 50 && cursor; i++) {
    const node: string = cursor;
    if (node === joiningOrgId) return null; // would form a loop — skip silently
    const upRes = await service
      .from("referrals")
      .select("referrer_organization_id")
      .eq("referred_organization_id", node)
      .maybeSingle();
    cursor = (upRes.data?.referrer_organization_id as string | undefined) ?? null;
  }

  const { error: insErr } = await service.from("referrals").insert({
    referrer_organization_id: referrerOrgId,
    referred_organization_id: joiningOrgId,
    code: clean,
    status: "pending",
  });
  if (insErr) return insErr.message;

  // Grant welcome bonus immediately; referrer chain waits for subscription.
  await grantCredits(service, joiningOrgId, REFERRAL_WELCOME_BONUS, "referral_welcome", {
    sourceOrgId: referrerOrgId,
    note: "Welcome bonus",
  });

  return null; // success
}

// Pay the referral chain for an org that has just activated a paid plan.
// Finds the 'pending' referral edge (created at signup via claimReferralCode),
// flips it to 'subscribed', then calls awardReferralChain — ensuring the reward
// fires exactly once per referral regardless of plan changes or renewals.
export async function awardReferralOnSubscription(
  orgId: string,
  service: ServiceClient,
): Promise<void> {
  const { data: referral, error } = await service
    .from("referrals")
    .select("id, referrer_organization_id")
    .eq("referred_organization_id", orgId)
    .eq("status", "pending")
    .maybeSingle();
  if (error || !referral) return;

  const { error: updErr } = await service
    .from("referrals")
    .update({ status: "subscribed" })
    .eq("id", referral.id);
  if (updErr) {
    console.error("[referral] failed to mark subscribed:", updErr.message);
    return;
  }

  await awardReferralChain(service, orgId);
}

// Pay the upline of a newly-joined org: the direct referrer earns an escalating
// tier reward (+ any milestone bonus), and ancestors deeper up earn decaying
// overrides — the compounding downline.
export async function awardReferralChain(
  service: ServiceClient,
  referredOrgId: string,
): Promise<void> {
  let child: string | null = referredOrgId;

  for (let level = 1; level <= MAX_LEVEL && child; level++) {
    const node: string = child;
    const edgeRes = await service
      .from("referrals")
      .select("referrer_organization_id")
      .eq("referred_organization_id", node)
      .maybeSingle();
    const ancestor: string | null =
      (edgeRes.data?.referrer_organization_id as string | undefined) ?? null;
    if (!ancestor) break;

    if (level === 1) {
      const { count } = await service
        .from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("referrer_organization_id", ancestor);
      const nth = count ?? 1;
      await grantCredits(service, ancestor, directReward(nth), "referral_direct", {
        sourceOrgId: referredOrgId,
        level: 1,
        note: `Direct referral #${nth}`,
      });
      const ms = milestoneAt(nth);
      if (ms) {
        await grantCredits(service, ancestor, ms.bonus, "referral_milestone", {
          sourceOrgId: referredOrgId,
          level: 1,
          note: `${ms.rank} milestone`,
        });
      }
    } else {
      const override = levelOverride(level);
      if (override > 0) {
        await grantCredits(service, ancestor, override, "referral_override", {
          sourceOrgId: referredOrgId,
          level,
          note: `Level ${level} override`,
        });
      }
    }
    child = ancestor;
  }
}

export interface PurchaseGiftResult {
  ok: boolean;
  error?: string;
  gift?: CreditGift;
}

// Buy a credit pack as a gift for someone else. Called from fulfillCheckout()
// after Stripe payment is confirmed — the gift row is created in 'pending' here
// and moves real credits to the recipient when they redeem their token.
export async function purchaseGift(args: {
  senderOrgId: string;
  createdBy: string | null;
  recipientEmail: string;
  packKey: string;
  message?: string;
}): Promise<PurchaseGiftResult> {
  const email = args.recipientEmail.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return { ok: false, error: "Enter a valid recipient email." };
  const pack = CREDIT_PACKS.find((p) => p.key === args.packKey);
  if (!pack) return { ok: false, error: "Pick a credit pack to gift." };

  const service = createServiceClient();
  const { data, error } = await service
    .from("credit_gifts")
    .insert({
      sender_organization_id: args.senderOrgId,
      recipient_email: email,
      credits: pack.credits,
      amount_usd: pack.price,
      message: args.message?.trim() || null,
      created_by: args.createdBy,
      status: "pending",
    })
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, gift: data as CreditGift };
}

export async function getSentGifts(orgId: string): Promise<CreditGift[]> {
  try {
    const supabase = await createServerClient();
    const { data } = await supabase
      .from("credit_gifts")
      .select("*")
      .eq("sender_organization_id", orgId)
      .order("created_at", { ascending: false });
    return (data ?? []) as CreditGift[];
  } catch (err) {
    console.error("[gift-earn] getSentGifts failed:", err);
    return [];
  }
}

export interface RedeemGiftResult {
  ok: boolean;
  error?: string;
  credits?: number;
}

// Redeem a gift token: credit the redeeming org and mark the gift used.
export async function redeemGift(
  token: string,
  redeemingOrgId: string,
): Promise<RedeemGiftResult> {
  const clean = token.trim();
  if (!clean) return { ok: false, error: "Enter a gift code." };

  const service = createServiceClient();
  const { data: gift } = await service
    .from("credit_gifts")
    .select("*")
    .eq("redeem_token", clean)
    .maybeSingle();
  if (!gift) return { ok: false, error: "That gift code isn't valid." };
  if (gift.status !== "pending")
    return { ok: false, error: "This gift has already been redeemed." };
  if (gift.sender_organization_id === redeemingOrgId)
    return { ok: false, error: "You can't redeem your own gift." };

  // Claim the gift atomically BEFORE granting credits: the conditional flip on
  // `status = 'pending'` is the concurrency guard. Two simultaneous redemptions
  // of the same token both pass the read check above, but only one wins this
  // compare-and-set — the loser gets zero rows back and no credits. Granting
  // first (the previous order) let both winners double-credit real billing
  // currency.
  const { data: claimed } = await service
    .from("credit_gifts")
    .update({
      status: "redeemed",
      redeemed_by_organization_id: redeemingOrgId,
      redeemed_at: new Date().toISOString(),
    })
    .eq("id", gift.id)
    .eq("status", "pending")
    .select("id");
  if (!claimed || claimed.length === 0)
    return { ok: false, error: "This gift has already been redeemed." };

  await grantCredits(service, redeemingOrgId, gift.credits, "gift_received", {
    sourceOrgId: gift.sender_organization_id,
    note: "Gift redeemed",
  });

  return { ok: true, credits: gift.credits };
}
