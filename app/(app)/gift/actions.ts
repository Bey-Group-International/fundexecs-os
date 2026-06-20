"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { purchaseGift, redeemGift, redeemReferralCode } from "@/lib/gift-earn";

// Buy a credit pack as a gift for a recipient email (payment mocked).
export async function purchaseGiftAction(
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };

  const res = await purchaseGift({
    senderOrgId: ctx.orgId,
    createdBy: ctx.userId,
    recipientEmail: String(formData.get("recipient_email") ?? ""),
    packKey: String(formData.get("pack_key") ?? ""),
    message: String(formData.get("message") ?? ""),
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
