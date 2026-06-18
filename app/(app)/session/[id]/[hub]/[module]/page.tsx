import { ModuleView } from "@/components/ModuleView";
import { HUB_BY_KEY } from "@/lib/hubs";
import type { Hub } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

const HUB_KEYS: Hub[] = ["build", "source", "run", "execute"];

// A Hub Module running inside the session frame. The session layout (command
// bar) persists above this, so opening a module never exits the session.
export default function SessionModulePage({
  params,
}: {
  params: { id: string; hub: string; module: string };
}) {
  const valid = HUB_KEYS.includes(params.hub as Hub);
  const hub = valid ? HUB_BY_KEY[params.hub as Hub] : null;
  const mod = hub?.modules.find((m) => m.key === params.module);

  return (
    <div className="mx-auto max-w-4xl">
      {hub && mod ? (
        <header className="mb-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            {hub.label} · in session
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-fg-primary">
            {mod.label}
          </h1>
        </header>
      ) : null}
      <ModuleView hub={params.hub} module={params.module} sessionId={params.id} />
    </div>
  );
}
