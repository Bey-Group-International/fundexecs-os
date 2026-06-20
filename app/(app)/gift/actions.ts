"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { purchaseGift, redeemGift, redeemReferralCode } from "@/lib/gift-earn";
import { stripeConfigured, createCheckout } from "@/lib/stripe";

// Buy a credit pack as a gift for a recipient email. With Stripe configured this
// opens a hosted Checkout and the gift is created (and becomes redeemable) on
// payment return; without Stripe it falls back to creating the gift immediately
// (mock payment).
export async function purchaseGiftAction(
  formData: FormData,
): Promise<{ error?: string; ok?: boolean; url?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };

  const recipientEmail = String(formData.get("recipient_email") ?? "");
  const packKey = String(formData.get("pack_key") ?? "");
  const message = String(formData.get("message") ?? "");

  if (stripeConfigured()) {
    return createCheckout({
      kind: "gift",
      orgId: ctx.orgId,
      createdBy: ctx.userId,
      packKey,
      recipientEmail,
      message,
    });
  }

  const res = await purchaseGift({
    senderOrgId: ctx.orgId,
    createdBy: ctx.userId,
    recipientEmail,
    packKey,
    message,
  });
  if (!res.ok) return { error: res.error };
  revalidatePath("/gift");
  return { ok: true };
}

// Redeem a referral code for the current org — credits the welcome bonus and
// pays the referrer's upline.
export async function redeemReferralAction(
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };

  const res = await redeemReferralCode(String(formData.get("code") ?? ""), ctx.orgId);
  if (!res.ok) return { error: res.error };
  revalidatePath("/gift");
  revalidatePath("/wallet");
  return { ok: true };
}

// Redeem a gift token for the current org.
export async function redeemGiftAction(
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };

  const res = await redeemGift(String(formData.get("token") ?? ""), ctx.orgId);
  if (!res.ok) return { error: res.error };
  revalidatePath("/gift");
  revalidatePath("/wallet");
  return { ok: true };
}
