import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { decodeShare } from "@/lib/pixel-studio/character";
import type { CharacterConfig } from "@/lib/pixel-studio/types";
import { PixelCharacterStudio } from "@/components/pixel-studio/PixelCharacterStudio";

export const metadata: Metadata = {
  title: "Pixel Character Studio · Virtual Office · FundExecs OS",
  description:
    "Assemble a raster pixel-art executive avatar — skin, face, hair, outfits, accessories — preview all directions and animations, and export WorkAdventure-compatible layers.",
};

export const dynamic = "force-dynamic";

// The Pixel Character Studio is the raster replacement for the legacy vector
// avatar. It is fully client-side and deterministic (the manifest is built in
// code), so the page only enforces auth and decodes an optional ?c= share
// token into the initial configuration.
export default async function PixelStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const { c } = await searchParams;
  let initial: CharacterConfig | undefined;
  if (c) {
    try {
      initial = decodeShare(c);
    } catch {
      initial = undefined;
    }
  }

  return (
    <div className="p-1">
      <PixelCharacterStudio initial={initial} />
    </div>
  );
}
