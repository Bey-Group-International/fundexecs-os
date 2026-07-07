"use client";

import { MobileSheet } from "./MobileSheet";
import { useQueueItems, labelFor } from "./offlineQueue";
import { relativeTime } from "./format";
import { haptic } from "./haptics";

// Review sheet for the durable offline action queue. Lets an operator see every
// action still waiting to reach the server, retry the whole batch, or dismiss an
// individual item they no longer want sent. Mobile-only by construction (renders
// inside a MobileSheet).
export function MobilePendingSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { items, remove, flush } = useQueueItems();

  return (
    <MobileSheet
      open={open}
      onClose={onClose}
      title="Pending sync"
      subtitle="Actions waiting to reach the server."
      labelledBy="fx-pending-title"
    >
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
          <p className="font-display text-base font-semibold text-fg-primary">
            You&apos;re all synced
          </p>
          <p className="mt-1 text-[13px] text-fg-muted">
            Nothing is waiting to send.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-1 pb-1">
          <button
            type="button"
            onClick={() => {
              haptic("tap");
              flush();
            }}
            className="fx-tap w-full rounded-2xl bg-gradient-to-br from-gold-300 to-gold-500 py-2.5 text-[13px] font-semibold text-surface-0"
          >
            Retry all now
          </button>

          <ul className="flex flex-col gap-2">
            {items.map((item) => {
              const queued = relativeTime(
                new Date(item.createdAt).toISOString(),
              );
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-2xl border border-line/60 bg-surface-0/60 px-3.5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-fg-primary">
                      {labelFor(item)}
                    </p>
                    {queued && (
                      <p className="mt-0.5 text-[12px] text-fg-secondary">
                        · queued {queued}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={() => {
                      haptic("warn");
                      remove(item.id);
                    }}
                    className="fx-tap flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line/70 text-fg-muted transition hover:border-status-danger/40 hover:text-status-danger"
                  >
                    <svg
                      width={14}
                      height={14}
                      viewBox="0 0 14 14"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d="M3 3l8 8M11 3l-8 8"
                        stroke="currentColor"
                        strokeWidth={1.6}
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </MobileSheet>
  );
}
