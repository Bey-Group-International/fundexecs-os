"use client";

import Link from "next/link";
import type { ComponentType, SVGProps } from "react";
import { SparkIcon, ContactIcon, TaskIcon } from "./icons";
import { haptic } from "./haptics";

type Item = {
  key: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  href: string;
  external?: boolean; // mailto: / tel:
  primary?: boolean;
};

// Phone icon (kept local — the shared set has no dedicated call glyph).
function PhoneIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
      <path d="M6.5 3.5 9 4l1 3.5-2 1.5a11 11 0 0 0 5 5l1.5-2 3.5 1 .5 2.5a2 2 0 0 1-2 2.3A16 16 0 0 1 4.2 5.5a2 2 0 0 1 2.3-2Z" />
    </svg>
  );
}

// A thumb-reachable sticky action bar for the LP / contact war room on mobile,
// mirroring the deal bar. Adapts to the contact's details: Ask Earn is always
// present; Email and Call appear when an address / number exists, otherwise a
// follow-up Task fills the slot. Capped at three so the bar stays one-handed.
// `md:hidden`; the page renders a matching spacer. Desktop is unaffected.
export function MobileContactActionBar({
  name,
  email,
  phone,
}: {
  name: string;
  email?: string | null;
  phone?: string | null;
}) {
  const items: Item[] = [
    {
      key: "earn",
      label: "Ask Earn",
      icon: SparkIcon,
      href: `/earn?ask=${encodeURIComponent(`Draft the next best outreach to ${name}`)}`,
      primary: true,
    },
  ];
  if (email) items.push({ key: "email", label: "Email", icon: ContactIcon, href: `mailto:${email}`, external: true });
  if (phone) items.push({ key: "call", label: "Call", icon: PhoneIcon, href: `tel:${phone}`, external: true });
  if (items.length < 3) {
    items.push({
      key: "task",
      label: "Follow up",
      icon: TaskIcon,
      href: `/earn?ask=${encodeURIComponent(`Create a follow-up task for ${name}`)}`,
    });
  }
  const actions = items.slice(0, 3);

  return (
    <div
      className="fx-appnav fixed inset-x-0 z-40 bottom-[calc(3.75rem+env(safe-area-inset-bottom,0px))] flex items-stretch gap-2 border-t border-line/60 px-3 py-2.5 md:hidden print:hidden"
      role="group"
      aria-label="Contact actions"
    >
      {actions.map((a) => {
        const Icon = a.icon;
        const cls = `fx-tap flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-[12.5px] font-semibold transition active:scale-[0.98] ${
          a.primary
            ? "border-gold-300/40 bg-gradient-to-br from-gold-300 to-gold-500 text-surface-0"
            : "border-line bg-surface-1 text-fg-secondary active:bg-surface-2"
        }`;
        const inner = (
          <>
            <Icon width={17} height={17} />
            {a.label}
          </>
        );
        return a.external ? (
          <a key={a.key} href={a.href} onClick={() => haptic("tap")} className={cls}>
            {inner}
          </a>
        ) : (
          <Link key={a.key} href={a.href} onClick={() => haptic("tap")} className={cls}>
            {inner}
          </Link>
        );
      })}
    </div>
  );
}
