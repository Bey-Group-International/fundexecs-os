import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { PixelMapStudio } from "@/components/pixel-studio/PixelMapStudio";

export const metadata: Metadata = {
  title: "Pixel Map Studio · Virtual Office · FundExecs OS",
  description:
    "Design a 32×32 tile workspace — furniture, signage, screens, collisions, and interaction zones — and export a WorkAdventure-compatible Tiled map bundle.",
};

export const dynamic = "force-dynamic";

export default async function PixelMapStudioPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  return (
    <div className="p-1">
      <PixelMapStudio />
    </div>
  );
}
