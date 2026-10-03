import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSessionContext } from "@/lib/auth";
import { DeviceCheck } from "./DeviceCheck";

export const metadata: Metadata = {
  title: "Test your camera & mic — FundExecs OS",
};

export const dynamic = "force-dynamic";

/**
 * A device check without a meeting. A static segment, so it is matched before
 * the `[roomId]` route beside it — no room code has this shape anyway.
 */
export default async function DeviceCheckPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  return <DeviceCheck />;
}
