"use client";

import { useOnline } from "./useOnline";

// A slim, unmissable banner shown on mobile when the device loses connectivity,
// so the on-the-go operator knows why actions might defer or fail — and knows
// the app noticed. Sits just above the bottom tab bar; `md:hidden`. Desktop is
// unaffected.
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fx-sheet-enter fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom,0px))] z-[45] flex items-center justify-center gap-2 border-t border-status-warning/30 bg-[rgb(38_30_12)]/95 px-4 py-2 backdrop-blur-xl md:hidden print:hidden"
    >
      <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-warning" />
      <span className="text-[12px] font-medium text-status-warning">
        You&apos;re offline — we&apos;ll reconnect and sync automatically.
      </span>
    </div>
  );
}
