import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import ProspectingClient from "./ProspectingClient";

export const metadata: Metadata = {
  title: "Prospecting · FundExecs OS",
  description:
    "Earn's prospecting copilot — turn a goal into a scored, compliance-gated, approval-ready outreach plan.",
};

export const dynamic = "force-dynamic";

// The prospecting surface of the Relationship Intelligence Engine: enter a goal,
// and Earn sources + scores + compliance-gates prospects and routes an
// approval-ready plan. Read-only planning — outreach still passes the gate.
export default async function ProspectingPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  return <ProspectingClient />;
}
