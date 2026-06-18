"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { HubModule } from "@/lib/hubs";

// Top-of-screen module switcher for a hub. Deep-linkable (each tab is a real
// /[hub]/[module] URL) and highlights the active module from the pathname.
export function HubTabs({ hubKey, modules }: { hubKey: string; modules: HubModule[] }) {
  const pathname = usePathname();
  return (
    <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {modules.map((m) => {
        const href = `/${hubKey}/${m.key}`;
        const active = pathname === href;
        return (
          <Link
            key={m.key}
            href={href}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition ${
              active
                ? "border-gold-400 font-medium text-fg-primary"
                : "border-transparent text-fg-secondary hover:text-fg-primary"
            }`}
          >
            {m.label}
          </Link>
        );
      })}
    </div>
  );
}
