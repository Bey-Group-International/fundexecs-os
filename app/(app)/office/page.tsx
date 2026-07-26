import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { normalizeAvatarConfig, statusHex } from "@/lib/office/avatarConfig";
import { renderAvatarPaperDollSvg } from "@/lib/office/avatarPaperDoll";
import { OfficeFrame, type YouAvatar } from "./OfficeFrame";

export const dynamic = "force-dynamic";

// The virtual office is a self-contained map app served as a static asset
// (public/office/map.html) and embedded via an iframe (OfficeFrame). Opens in a
// clean view (Top / 1st-person nav); right-click surfaces Build Mode and
// Character Studio (which navigates the app to /office/builder).
//
// If the member has designed a character (Character Studio → office_member_prefs
// .avatar), we render it here with the SHARED paper-doll builder and hand the
// markup to the map, which places it on the floor as a movable "you". No saved
// character → the office runs as before and the right-click Studio invites them.
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
  return {
    // Inner markup only (no <svg> wrapper) — the map embeds it in its own scene
    // <svg>. No ground shadow: the map paints its own depth-consistent shadow.
    svg: renderAvatarPaperDollSvg(config, { inner: true, showShadow: false }),
    name: config.displayName || "You",
    status: statusHex(config),
  };
}
