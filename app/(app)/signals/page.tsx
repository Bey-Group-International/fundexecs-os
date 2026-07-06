import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import SignalsClient from "./SignalsClient";

export const metadata: Metadata = {
  title: "Intent Signals · FundExecs OS",
  description: "First-party intent — who is engaging with your deal shares, data room, marketplace, and portal.",
};

export const dynamic = "force-dynamic";

// Interest-routing surface of the Relationship Intelligence Engine: read-only
// feed of first-party engagement signals to route into the prospecting pipeline.
export default async function SignalsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  return <SignalsClient />;
}
