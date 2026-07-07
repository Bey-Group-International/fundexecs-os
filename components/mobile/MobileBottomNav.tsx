"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, type TabItem } from "./nav-config";
import { haptic } from "./haptics";
import { useTabReselect } from "./useTabReselect";

function isActive(pathname: string, tab: TabItem): boolean {
  if (tab.key === "more") return false;
  const prefixes = tab.match ?? [tab.href];
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/") || (p !== "/" && pathname.startsWith(p)));
}

// Native-style bottom tab bar: five primary destinations (Home, Earn, Deals,
// Network, More). The persistent quick-action FAB floats above this bar and is
// rendered separately by AppShellMobile. Fixed to the foot of the viewport
// with safe-area padding; mounted only inside the `md:hidden` app shell.
export function MobileBottomNav({
  approvalsCount = 0,
  onMore,
  moreOpen,
  hidden = false,
}: {
  approvalsCount?: number;
  onMore: () => void;
  moreOpen: boolean;
  hidden?: boolean;
}) {
  const pathname = usePathname() || "/";
  // Native re-tap-to-top: tapping the tab you're already on scrolls to the top.
  const reselect = useTabReselect();

  function Item({ tab, active, badge }: { tab: TabItem; active: boolean; badge?: number }) {
    const Icon = tab.icon;
    return (
      <span className="relative flex flex-col items-center justify-center gap-1">
        {active && <span aria-hidden className="absolute -top-[11px] h-1 w-6 rounded-full bg-gradient-to-r from-gold-300 to-gold-500" />}
        <span className={`relative transition-colors ${active ? "text-gold-400" : "text-fg-muted"}`}>
          <Icon width={22} height={22} />
          {badge ? (
            <span className="absolute -right-2.5 -top-1.5 flex min-w-[16px] items-center justify-center rounded-full bg-status-danger px-1 text-[9px] font-semibold leading-[16px] text-white ring-2 ring-surface-1">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </span>
        <span className={`text-[10px] font-medium leading-none tracking-tight transition-colors ${active ? "text-gold-300" : "text-fg-muted"}`}>
          {tab.label}
        </span>
      </span>
    );
  }

  return (
    <nav
      aria-label="Primary"
      aria-hidden={hidden}
      className={`fx-appnav fixed inset-x-0 bottom-0 z-50 pb-safe transition-transform duration-300 md:hidden ${
        hidden ? "translate-y-full" : "translate-y-0"
      }`}
    >
      <div className="mx-auto grid h-[60px] max-w-lg grid-cols-5 items-center px-1">
        {TABS.map((tab) => {
          if (tab.key === "more") {
            return (
              <button
                key={tab.key}
                type="button"
                onClick={onMore}
                aria-label="More"
                aria-expanded={moreOpen}
                tabIndex={hidden ? -1 : 0}
                className="fx-tap flex h-full items-center justify-center"
              >
                <Item tab={tab} active={moreOpen} badge={approvalsCount} />
              </button>
            );
          }
          const active = isActive(pathname, tab);
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-label={tab.label}
              aria-current={active ? "page" : undefined}
              tabIndex={hidden ? -1 : 0}
              onClick={() => {
                haptic("tap");
                reselect(tab.href);
              }}
              className="fx-tap flex h-full items-center justify-center"
            >
              <Item tab={tab} active={active} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
