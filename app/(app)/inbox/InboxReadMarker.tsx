"use client";

import { useEffect } from "react";

// Clears the unread badges when the operator opens the inbox.
//
// The page mounts this only when a thread is actually unread, so the write
// below never fires on a clean inbox. When it does fire, `markOpenThreadsRead`
// calls revalidatePath("/inbox") and Next re-renders this route from the action
// response — so the refreshed board arrives with the action, and the extra
// client-side router.refresh() this used to do (a second full render of a
// force-dynamic, query-heavy page) is redundant.
export function InboxReadMarker({ action }: { action: () => Promise<void> }) {
  useEffect(() => {
    action().catch(console.error);
    // action is a stable server-action ref — intentionally excluded so this
    // fires on mount, not just when the prop reference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
