"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { redeemGift, redeemReferralCode } from "@/lib/gift-earn";
import { stripeConfigured, createCheckout } from "@/lib/stripe";

// Buy a credit pack as a gift for a recipient email. With Stripe configured this
// opens an in-app embedded Checkout and the gift is created (and becomes
// redeemable) on payment return; without Stripe it fails closed so paid credits
// are never created without checkout.
export async function purchaseGiftAction(
  formData: FormData,
): Promise<{ error?: string; ok?: boolean; clientSecret?: string }> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { error: "Not authenticated" };

    const recipientEmail = String(formData.get("recipient_email") ?? "");
    const packKey = String(formData.get("pack_key") ?? "");
    const message = String(formData.get("message") ?? "");

    if (stripeConfigured()) {
      return await createCheckout({
        kind: "gift",
        orgId: ctx.orgId,
        createdBy: ctx.userId,
        packKey,
        recipientEmail,
        message,
      });
    }

    return { error: "Billing is not enabled for this organization yet. Contact support to send gifts." };
  } catch (err) {
    console.error("[gift] purchaseGiftAction failed:", err);
    return { error: "Something went wrong starting checkout. Please try again." };
  }
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
