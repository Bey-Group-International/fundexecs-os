"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Fires the markOpenThreadsRead server action once when the inbox page mounts.
// Renders nothing — purely a side-effect component so the server page stays
// a server component while still clearing the unread flag on view.
export function InboxReadMarker({ action }: { action: () => Promise<void> }) {
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    action().then(() => { if (alive) router.refresh(); }).catch(console.error);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
