"use client";

import { useState } from "react";
import { useOnline } from "./useOnline";
import { usePendingSync } from "./offlineQueue";
import { MobilePendingSheet } from "./MobilePendingSheet";
import { haptic } from "./haptics";

// A slim connectivity + sync banner for the mobile app. Shows when the device
// is offline (so the on-the-go operator knows why actions defer) and/or when
// there are queued changes waiting to reach the server. It makes the durable
// offline queue visible: nothing is silently pending. When there is queued
// work, the banner is tappable — it opens a review sheet where the operator can
// retry the batch or drop individual items. Sits just above the bottom tab bar;
// `md:hidden`. Desktop is unaffected.
export function OfflineBanner() {
  const online = useOnline();
  const { pending } = usePendingSync();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (online && pending === 0) {
    // Keep the sheet mounted long enough to animate closed if it was open when
    // the last item drained; otherwise render nothing.
    return sheetOpen ? (
      <MobilePendingSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    ) : null;
  }

  const plural = pending === 1 ? "change" : "changes";
  const message = !online
    ? pending > 0
      ? `You're offline — ${pending} ${plural} will sync when you reconnect.`
      : "You're offline — we'll reconnect and sync automatically."
    : `Syncing ${pending} ${plural}…`;

  const tone = online
    ? { wrap: "border-neural-400/30 bg-[rgb(10_20_36)]/95", dot: "bg-neural-400 animate-pulse", text: "text-neural-300" }
    : { wrap: "border-status-warning/30 bg-[rgb(38_30_12)]/95", dot: "bg-status-warning animate-pulse", text: "text-status-warning" };

  // Only offer the review sheet when there is something queued to review.
  const tappable = pending > 0;

  const inner = (
    <>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      <span className={`text-[12px] font-medium ${tone.text}`}>{message}</span>
      {tappable && (
        <span className={`ml-1 text-[11px] font-semibold underline decoration-dotted underline-offset-2 ${tone.text}`}>
          Review
        </span>
      )}
    </>
  );

  const wrapClass = `fx-sheet-enter fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom,0px))] z-[45] flex items-center justify-center gap-2 border-t px-4 py-2 backdrop-blur-xl md:hidden print:hidden ${tone.wrap}`;

  return (
    <>
      {tappable ? (
        <button
          type="button"
          onClick={() => {
            haptic("select");
            setSheetOpen(true);
          }}
          aria-label={`${pending} ${plural} pending sync — review`}
          className={`fx-tap ${wrapClass}`}
        >
          {inner}
        </button>
      ) : (
        <div role="status" aria-live="polite" className={wrapClass}>
          {inner}
        </div>
      )}
      <MobilePendingSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
