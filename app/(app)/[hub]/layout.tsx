import { notFound } from "next/navigation";
import { HUB_BY_KEY } from "@/lib/hubs";
import type { Hub } from "@/lib/supabase/database.types";
import { HubTabs } from "./HubTabs";

const HUB_KEYS: Hub[] = ["build", "source", "run", "execute"];

// Every hub has its own page; its modules are switched seamlessly via the top
// module switcher this layout renders above the active module's content.
export default function HubLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { hub: string };
}) {
  if (!HUB_KEYS.includes(params.hub as Hub)) notFound();
  const hub = HUB_BY_KEY[params.hub as Hub];

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          {hub.label} Hub
        </span>
        <p className="mt-1 text-sm text-fg-secondary">{hub.purpose}</p>
      </header>
      <HubTabs hubKey={hub.key} modules={hub.modules} />
      {children}
    </div>
  );
}
