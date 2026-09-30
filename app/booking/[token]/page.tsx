// The invitee's booking-management page. The token in the URL is the only
// credential — it arrives by email and stands in for an account, exactly as a
// meeting room code does.
import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { SITE_NAME } from "@/lib/site";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { loadManageView } from "@/lib/meetings/booking-manage.server";
import type { ManageBookingView } from "@/lib/meetings/booking-manage";
import { ManageBooking } from "./ManageBooking";

export const dynamic = "force-dynamic";

// A booking link is private to whoever received it and must never be indexed.
export const metadata: Metadata = {
  title: `Your booking — ${SITE_NAME}`,
  robots: { index: false, follow: false },
};

export default async function ManageBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // The booking, read here rather than by the browser after it hydrates. This
  // page holds the token, so the request the client used to make was one the
  // server could always have made — seven database reads deep, and until they
  // came back an invitee clicking a link in an email saw nothing at all: not the
  // meeting, not its time, not even whether the link was any good.
  //
  // `undefined` means this read could not happen, which is not the same as a bad
  // link: the client then fetches as it always did rather than telling somebody
  // their booking does not exist because a deployment is missing its keys.
  let initialView: ManageBookingView | null | undefined;
  if (hasSupabaseServiceEnv()) {
    try {
      initialView = await loadManageView(createServiceClient(), token);
    } catch (err) {
      console.error("[booking/[token]] initial view", err);
    }
  }

  return (
    <div className="fx-blueprint min-h-screen bg-surface-0 px-4 py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
        <Logo />
        <ManageBooking token={token} initialView={initialView} serverNowIso={new Date().toISOString()} />
      </div>
    </div>
  );
}
