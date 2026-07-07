"use client";

import { useOnline } from "./useOnline";
import { usePendingSync } from "./offlineQueue";

// A slim connectivity + sync banner for the mobile app. Shows when the device
// is offline (so the on-the-go operator knows why actions defer) and/or when
// there are queued changes waiting to reach the server. It makes the durable
// offline queue visible: nothing is silently pending. Sits just above the
// bottom tab bar; `md:hidden`. Desktop is unaffected.
export function OfflineBanner() {
  const online = useOnline();
  const { pending } = usePendingSync();

  if (online && pending === 0) return null;

  const plural = pending === 1 ? "change" : "changes";
  const message = !online
    ? pending > 0
      ? `You're offline — ${pending} ${plural} will sync when you reconnect.`
      : "You're offline — we'll reconnect and sync automatically."
    : `Syncing ${pending} ${plural}…`;

  const tone = online
    ? { wrap: "border-neural-400/30 bg-[rgb(10_20_36)]/95", dot: "bg-neural-400 animate-pulse", text: "text-neural-300" }
    : { wrap: "border-status-warning/30 bg-[rgb(38_30_12)]/95", dot: "bg-status-warning animate-pulse", text: "text-status-warning" };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fx-sheet-enter fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom,0px))] z-[45] flex items-center justify-center gap-2 border-t px-4 py-2 backdrop-blur-xl md:hidden print:hidden ${tone.wrap}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      <span className={`text-[12px] font-medium ${tone.text}`}>{message}</span>
    </div>
  );
}
