"use client";

import Link from "next/link";
import { SparkIcon, DataRoomIcon, ShieldIcon } from "./icons";
import { haptic } from "./haptics";

// A thumb-reachable sticky action bar for the deal war room on mobile. Sits just
// above the bottom tab bar so the deal's most common moves — ask Earn for the
// next step, open its data room, jump to diligence — are one-handed without
// scrolling to find them. `md:hidden`; the deal page renders a matching spacer
// so no content hides behind it. Desktop keeps the war room's own controls.
export function MobileDealActionBar({ dealId, dealName }: { dealId: string; dealName: string }) {
  const actions = [
    {
      key: "earn",
      label: "Ask Earn",
      icon: SparkIcon,
      href: `/earn?ask=${encodeURIComponent(`What is the next best step on ${dealName}?`)}`,
      primary: true,
    },
    { key: "room", label: "Data Room", icon: DataRoomIcon, href: `/deal/${dealId}/room` },
    { key: "diligence", label: "Diligence", icon: ShieldIcon, href: "/run/diligence" },
  ];

  return (
    <div
      className="fx-appnav fixed inset-x-0 z-40 bottom-[calc(3.75rem+env(safe-area-inset-bottom,0px))] flex items-stretch gap-2 border-t border-line/60 px-3 py-2.5 md:hidden print:hidden"
      role="group"
      aria-label="Deal actions"
    >
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.key}
            href={a.href}
            onClick={() => haptic("tap")}
            className={`fx-tap flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-[12.5px] font-semibold transition active:scale-[0.98] ${
              a.primary
                ? "border-gold-300/40 bg-gradient-to-br from-gold-300 to-gold-500 text-surface-0"
                : "border-line bg-surface-1 text-fg-secondary active:bg-surface-2"
            }`}
          >
            <Icon width={17} height={17} />
            {a.label}
          </Link>
        );
      })}
    </div>
  );
}
