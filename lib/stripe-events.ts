import { createServiceClient } from "@/lib/supabase/server";

// claimStripeEvent: record that we're processing this Stripe event id. Returns
// true when newly claimed (caller should process), false when a row already
// exists (duplicate redelivery — caller should skip). On a DB error it fails
// OPEN (returns true) so a transient DB issue never silently drops a real event;
// the worst case is the pre-existing double-grant risk, which is rarer than an
// outage dropping events.
export async function claimStripeEvent(eventId: string, type: string): Promise<boolean> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("processed_stripe_events")
    .upsert({ id: eventId, type }, { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (error) {
    console.error("[stripe] claimStripeEvent failed:", error.message);
    return true;
  }
  return (data?.length ?? 0) > 0;
}

// releaseStripeEvent: delete the claim so Stripe's retry can re-process. Call
// this only when processing threw AFTER a successful claim.
export async function releaseStripeEvent(eventId: string): Promise<void> {
  try {
    const service = createServiceClient();
    await service.from("processed_stripe_events").delete().eq("id", eventId);
  } catch (err) {
    console.error("[stripe] releaseStripeEvent failed:", err);
  }
}
