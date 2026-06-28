"use client";

import { useEffect } from "react";

// Fires the markOpenThreadsRead server action once when the inbox page mounts.
// Renders nothing — purely a side-effect component so the server page stays
// a server component while still clearing the unread flag on view.
export function InboxReadMarker({ action }: { action: () => Promise<void> }) {
  useEffect(() => {
    void action();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
