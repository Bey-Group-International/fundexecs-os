"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Fires markOpenThreadsRead on every inbox mount so unread badges always
// clear promptly. The prior sessionStorage guard was too aggressive — it
// prevented re-marking when new threads arrived mid-session.
export function InboxReadMarker({ action }: { action: () => Promise<void> }) {
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    action().then(() => { if (alive) router.refresh(); }).catch(console.error);
    return () => { alive = false; };
    // action is a stable server-action ref — intentionally excluded so this
    // fires on every mount, not just when the prop reference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
