import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { OfficeTabs } from "@/components/executive-hq/OfficeTabs";

export const metadata: Metadata = {
  title: "Virtual Office · FundExecs OS",
  description:
    "The FundExecs Virtual Office — your executive team's living 2.5D headquarters, where Earn orchestrates sourcing, diligence, documents, and follow-up across the operating campus.",
};

export const dynamic = "force-dynamic";

// The Virtual Office is the primary interactive workspace: the spatial office
// world (built with Phaser) where the executive team works, meets in the
// boardroom, and moves around the campus. It lives at the canonical
// /virtual-office URL; the legacy /command-center path permanently redirects
// here (see next.config.mjs), preserving nested segments and query strings so
// existing deep links and invite URLs keep working. "Command Center" remains
// the name of the operational dashboard inside this larger environment.
export default async function VirtualOfficePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  return (
    <div className="overflow-hidden rounded-2xl border border-line/60 shadow-2xl">
      <OfficeTabs />
    </div>
  );
}
