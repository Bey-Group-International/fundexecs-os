import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { normalizeAvatarConfig, statusHex } from "@/lib/office/avatarConfig";
import { OfficeFrame, type YouAvatar } from "./OfficeFrame";

export const dynamic = "force-dynamic";

// The virtual office is a self-contained map app served as a static asset
// (public/office/map.html) and embedded via an iframe (OfficeFrame). Opens in a
// clean view (Top / 1st-person nav); right-click surfaces Build Mode and
// Character Selector (which navigates the app to /office/builder).
//
// If the member has chosen a character (Character Selector → office_member_prefs
// .avatar), we hand its config to OfficeFrame, which posts the character's walk
// atlas to the map, where it walks the floor as a movable "you". No saved
// character → the office runs as before and the right-click Selector invites
// them to pick one.
export default async function OfficePage() {
  const you = await loadYou();
  return <OfficeFrame you={you} />;
}

async function loadYou(): Promise<YouAvatar | null> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return null;

  const supabase = await createServerClient();
  const { data } = await supabase
    .from("office_member_prefs")
    .select("avatar")
    .eq("organization_id", ctx.orgId)
    .eq("principal_id", ctx.userId)
    .maybeSingle();

  const saved = (data as { avatar: unknown } | null)?.avatar ?? null;
  if (!saved) return null;

  const config = normalizeAvatarConfig(saved);
  return { config, name: config.displayName || "You", status: statusHex(config) };
}
