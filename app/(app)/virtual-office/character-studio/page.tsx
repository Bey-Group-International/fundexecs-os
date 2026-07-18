import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { parseUserAvatar, DEFAULT_USER_AVATAR } from "@/lib/office/userAvatar";
import { CharacterStudioShell } from "@/components/character-studio/CharacterStudioShell";

export const metadata: Metadata = {
  title: "Character Studio · Virtual Office · FundExecs OS",
  description:
    "Design your 2.5D executive avatar — appearance, wardrobe, and role — and publish it to the Virtual Office floor, meetings, and workflows.",
};

export const dynamic = "force-dynamic";

// The Character Studio configures the operator's own 2.5D executive figure.
// It reads the currently-published avatar from auth user_metadata (the same
// `office_avatar` the floor loads) and hands it to the client shell as the
// starting point; publishing writes back to that metadata.
export default async function CharacterStudioPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  const { data } = await supabase.auth.getUser();
  const initialAvatar = parseUserAvatar(data.user?.user_metadata?.office_avatar) ?? DEFAULT_USER_AVATAR;

  return (
    <div className="p-1">
      <a
        href="/virtual-office/pixel-studio"
        className="mb-2 flex items-center justify-between rounded-lg border border-[#c9a84c]/40 bg-[#c9a84c]/10 px-3 py-2 text-sm text-[#c9a84c] hover:bg-[#c9a84c]/20"
      >
        <span>✦ New: Pixel Character &amp; Map Studio — raster 16-bit executives with WorkAdventure export</span>
        <span aria-hidden>→</span>
      </a>
      <CharacterStudioShell initialAvatar={initialAvatar} />
    </div>
  );
}
