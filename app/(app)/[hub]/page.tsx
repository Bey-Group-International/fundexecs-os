import Link from "next/link";
import { notFound } from "next/navigation";
import { HUB_BY_KEY } from "@/lib/hubs";
import type { Hub } from "@/lib/supabase/database.types";

const HUB_KEYS: Hub[] = ["build", "source", "run", "execute"];

export default function HubPage({ params }: { params: { hub: string } }) {
  if (!HUB_KEYS.includes(params.hub as Hub)) notFound();
  const hub = HUB_BY_KEY[params.hub as Hub];

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          {hub.label} Hub
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          {hub.purpose}
        </h1>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {hub.modules.map((mod) => (
          <Link
            key={mod.key}
            href={`/${hub.key}/${mod.key}`}
            className="group rounded-xl border border-line bg-surface-1 p-5 transition hover:border-gold-500/40 hover:bg-surface-2"
          >
            <h2 className="font-display text-lg font-medium text-fg-primary">
              {mod.label}
            </h2>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted transition group-hover:text-gold-400">
              Open module →
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
