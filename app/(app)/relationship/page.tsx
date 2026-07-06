import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import RelationshipClient from "./RelationshipClient";

export const metadata: Metadata = {
  title: "Relationship Center · FundExecs OS",
  description: "The Relationship Command Center — contacts, campaigns, live intent, and Earn's recommended next moves.",
};

export const dynamic = "force-dynamic";

// The Relationship Command Center: one aggregated view over the engine
// (contacts, campaigns, intent signals) with recommended next actions.
export default async function RelationshipPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  return <RelationshipClient />;
}
