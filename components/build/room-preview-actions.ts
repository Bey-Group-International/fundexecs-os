"use server";

// The Preview as LP pane loads its payload when the tab opens, through this
// action, rather than on every visit to the Materials page. It is the same
// builder the live room uses, with no section allowlist: the widest view any
// link into the room can give. The room is checked against the caller's org.
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { buildViewerPayload, type ViewerPayload } from "@/lib/data-room-viewer.server";
import { DataRoomReadError, logReadFailure } from "@/lib/data-room-errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The preview payload, or null when it cannot be shown (nothing is partial). */
export async function loadRoomPreview(roomId: string): Promise<ViewerPayload | null> {
  // The page that used to build this was behind the MFA gate. A server action is
  // its own endpoint, so it applies the same gate itself: an owner or admin who
  // has not passed the second factor must not reach the room's contents here.
  const auth = await requireOrgContext();
  if (!auth.ok || !UUID.test(roomId)) return null;
  const supabase = await createServerClient();
  try {
    return await buildViewerPayload(supabase, auth.ctx.orgId, roomId, null);
  } catch (error) {
    // A failed read is "Preview unavailable", logged; anything else is a bug.
    if (!(error instanceof DataRoomReadError)) throw error;
    logReadFailure(error);
    return null;
  }
}
