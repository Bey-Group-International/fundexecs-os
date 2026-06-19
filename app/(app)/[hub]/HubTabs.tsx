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
    <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {modules.map((m) => {
        const href = `/${hubKey}/${m.key}`;
        const active = pathname === href;
        const status = statuses?.[m.key];
        return (
          <Link
            key={m.key}
            href={href}
            className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition ${
              active
                ? "border-gold-400 font-medium text-fg-primary"
                : "border-transparent text-fg-secondary hover:text-fg-primary"
            }`}
          >
            {status ? <StatusDot status={status} /> : null}
            {m.label}
          </Link>
        );
      })}
    </div>
  );
}
