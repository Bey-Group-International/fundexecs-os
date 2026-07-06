import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { OfficeTabs } from "@/components/executive-hq/OfficeTabs";

export const metadata: Metadata = {
  title: "Command Center · FundExecs OS",
  description:
    "The AI Executive Command Floor — your executive team's virtual headquarters, where Earn orchestrates sourcing, diligence, documents, and follow-up across the operating campus.",
};

export const dynamic = "force-dynamic";

// The Command Center is the AI Executive Command Floor: the spatial office
// world (built with Phaser) where the executive team works, meets in the
// boardroom, and moves around the campus. It lives at the canonical
// /command-center URL. Note: the app now opens to the Sessions page
// (/workspace) after login — the Command Center is reached from the sidebar.
export default async function CommandCenterPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  return (
    <div className="overflow-hidden rounded-2xl border border-line/60 shadow-2xl">
      <OfficeTabs />
    </div>
  );
}
