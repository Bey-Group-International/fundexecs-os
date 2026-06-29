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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
