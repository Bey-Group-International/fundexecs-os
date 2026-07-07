"use client";

import Link from "next/link";
import { MobileSheet } from "./MobileSheet";
import { QUICK_ACTIONS } from "./nav-config";
import { haptic } from "./haptics";

// The slide-up "quick action" drawer opened from the center FAB. The fastest
// way to get work moving inside the app — one tap from anywhere.
export function MobileQuickAction({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <MobileSheet
      open={open}
      onClose={onClose}
      title="Quick actions"
      subtitle="Start something — Earn and your agents take it from here."
      labelledBy="fx-quick-title"
    >
      <ul className="grid grid-cols-1 gap-1.5">
        {QUICK_ACTIONS.map((a) => {
          const Icon = a.icon;
          return (
            <li key={a.key}>
              <Link
                href={a.href}
                onClick={() => {
                  haptic("tap");
                  onClose();
                }}
                className="fx-tap group flex items-center gap-3.5 rounded-2xl border border-line/60 bg-surface-0/60 px-3.5 py-3 transition active:scale-[0.99] active:bg-surface-2"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gold-500/25 bg-gold-500/[0.08] text-gold-400 transition group-hover:border-gold-500/45">
                  <Icon width={20} height={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-medium text-fg-primary">{a.label}</span>
                    {a.gated && (
                      <span className="shrink-0 rounded-full border border-neural-400/40 px-1.5 py-px font-mono text-[8px] uppercase tracking-wider text-neural-300">
                        Approval
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-fg-secondary">{a.hint}</span>
                </span>
                <span aria-hidden className="text-fg-muted transition group-hover:translate-x-0.5 group-hover:text-gold-400">
                  ›
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </MobileSheet>
  );
}
