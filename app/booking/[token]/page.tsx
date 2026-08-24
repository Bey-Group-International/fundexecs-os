// The invitee's booking-management page. The token in the URL is the only
// credential — it arrives by email and stands in for an account, exactly as a
// meeting room code does.
import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { SITE_NAME } from "@/lib/site";
import { ManageBooking } from "./ManageBooking";

export const dynamic = "force-dynamic";

// A booking link is private to whoever received it and must never be indexed.
export const metadata: Metadata = {
  title: `Your booking — ${SITE_NAME}`,
  robots: { index: false, follow: false },
};

export default async function ManageBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <div className="fx-blueprint min-h-screen bg-surface-0 px-4 py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
        <Logo />
        <ManageBooking token={token} />
      </div>
    </div>
  );
}
