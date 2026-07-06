import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import CampaignsClient from "./CampaignsClient";

export const metadata: Metadata = {
  title: "Campaigns · FundExecs OS",
  description: "Outreach analytics across your enrolled sequences — enrollments, completions, replies, and reply rate.",
};

export const dynamic = "force-dynamic";

// Campaign analytics surface of the Relationship Intelligence Engine: read-only
// reporting over the sequences prospects are enrolled into.
export default async function CampaignsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  return <CampaignsClient />;
}
