"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const READ_KEY = "fx_inbox_read_v1";

// Fires the markOpenThreadsRead server action once per browser session when
// the inbox page mounts. The sessionStorage guard prevents redundant DB writes
// on rapid back-and-forth navigation within the same tab session.
export function InboxReadMarker({ action }: { action: () => Promise<void> }) {
  const router = useRouter();
  useEffect(() => {
    if (sessionStorage.getItem(READ_KEY)) return;
    sessionStorage.setItem(READ_KEY, "1");
    let alive = true;
    action().then(() => { if (alive) router.refresh(); }).catch(console.error);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
