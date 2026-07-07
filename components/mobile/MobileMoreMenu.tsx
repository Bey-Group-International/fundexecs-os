"use client";

import Link from "next/link";
import { MobileSheet } from "./MobileSheet";
import { MORE_GROUPS } from "./nav-config";

// The "More" tab sheet — everything that doesn't earn a primary tab: workspace
// surfaces, documents, account, billing, help, and sign-out.
export function MobileMoreMenu({
  open,
  onClose,
  name,
  planName,
  signOutAction,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  planName: string;
  signOutAction: () => void | Promise<void>;
}) {
  return (
    <MobileSheet open={open} onClose={onClose} labelledBy="fx-more-title">
      {/* Identity header */}
      <div className="mb-3 flex items-center gap-3 rounded-2xl border border-line/60 bg-surface-0/60 px-3.5 py-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gold-500/30 bg-gold-500/10 font-display text-base font-semibold text-gold-300">
          {name.trim().charAt(0).toUpperCase() || "F"}
        </span>
        <div className="min-w-0">
          <p id="fx-more-title" className="truncate text-[15px] font-semibold text-fg-primary">
            {name}
          </p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-gold-400">{planName} plan</p>
        </div>
        <Link
          href="/settings/account"
          onClick={onClose}
          className="fx-tap ml-auto shrink-0 rounded-lg border border-line px-3 py-1.5 text-[12px] text-fg-secondary transition hover:border-gold-500/40 hover:text-fg-primary"
        >
          Manage
        </Link>
      </div>

      {MORE_GROUPS.map((group) => (
        <section key={group.heading} className="mb-3">
          <h3 className="mb-1.5 flex items-center gap-2 px-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            <span aria-hidden className="h-2.5 w-0.5 rounded-full bg-gold-500/70" />
            {group.heading}
          </h3>
          <ul className="overflow-hidden rounded-2xl border border-line/60 bg-surface-0/50">
            {group.items.map((item, i) => {
              const Icon = item.icon;
              return (
                <li key={item.key} className={i > 0 ? "border-t border-line/50" : ""}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className="fx-tap flex items-center gap-3 px-3.5 py-3 transition active:bg-surface-2"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line/70 bg-surface-1 text-fg-secondary">
                      <Icon width={18} height={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-fg-primary">{item.label}</span>
                      {item.desc && <span className="block truncate text-[11.5px] text-fg-secondary">{item.desc}</span>}
                    </span>
                    <span aria-hidden className="text-fg-muted">›</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <form action={signOutAction} className="mt-4">
        <button
          type="submit"
          className="fx-tap w-full rounded-2xl border border-status-danger/35 bg-status-danger/[0.06] px-4 py-3 text-[14px] font-medium text-status-danger transition active:scale-[0.99]"
        >
          Sign out
        </button>
      </form>
      <p className="mt-3 pb-2 text-center font-mono text-[9px] uppercase tracking-widest text-fg-muted">
        FundExecs OS · Private markets, in your pocket
      </p>
    </MobileSheet>
  );
}
