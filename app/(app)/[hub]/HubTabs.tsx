"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { HubModule } from "@/lib/hubs";

type ModuleStatus = "empty" | "started" | "complete";

// Small per-module progress marker shown in the switcher when statuses are
// supplied (Build hub): a check when complete, a dot when in progress.
function StatusDot({ status }: { status: ModuleStatus }) {
  if (status === "complete")
    return <span className="font-mono text-[10px] text-emerald-400">✓</span>;
  if (status === "started")
    return <span className="h-1.5 w-1.5 rounded-full bg-gold-400" aria-hidden />;
  return <span className="h-1.5 w-1.5 rounded-full border border-line" aria-hidden />;
}

// Top-of-screen module switcher for a hub. Deep-linkable (each tab is a real
// /[hub]/[module] URL) and highlights the active module from the pathname.
// When `statuses` is provided, each tab shows its completion state.
export function HubTabs({
  hubKey,
  modules,
  statuses,
}: {
  hubKey: string;
  modules: HubModule[];
  statuses?: Record<string, ModuleStatus>;
}) {
  const pathname = usePathname();
  return (
    <div className="mb-6 flex gap-0.5 overflow-x-auto border-b border-line">
      {modules.map((m) => {
        const href = `/${hubKey}/${m.key}`;
        const active = pathname === href;
        const status = statuses?.[m.key];
        return (
          <Link
            key={m.key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`group relative -mb-px flex items-center gap-1.5 whitespace-nowrap rounded-t-md px-3 py-2.5 text-sm transition ${
              active
                ? "font-medium text-fg-primary"
                : "text-fg-secondary hover:bg-surface-1 hover:text-fg-primary"
            }`}
          >
            {status ? <StatusDot status={status} /> : null}
            {m.label}
            <span
              aria-hidden
              className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-gold-300 to-gold-500 transition-opacity ${
                active ? "opacity-100" : "opacity-0 group-hover:opacity-30"
              }`}
            />
          </Link>
        );
      })}
    </div>
  );
}
