import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { parseUserAvatar, DEFAULT_USER_AVATAR } from "@/lib/office/userAvatar";
import { PhotoAvatarGenerator } from "@/components/character-studio/generator/PhotoAvatarGenerator";

export const metadata: Metadata = {
  title: "Create from photo · Character Studio · FundExecs OS",
  description:
    "Turn a portrait into a 2.5D executive avatar — processed entirely on your device, fully editable, and never uploaded.",
};

export const dynamic = "force-dynamic";

// Create-from-photo generates an editable avatar from a portrait. All image
// processing happens on the client (see the on-device provider); the server
// only supplies the seed identity (name/role) from the published avatar so a
// generated figure carries the operator's identity.
export default async function CreateFromPhotoPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  const { data } = await supabase.auth.getUser();
  const base = parseUserAvatar(data.user?.user_metadata?.office_avatar) ?? DEFAULT_USER_AVATAR;

  return (
    <div className="p-1">
      <PhotoAvatarGenerator base={base} />
    </div>
  );
}
