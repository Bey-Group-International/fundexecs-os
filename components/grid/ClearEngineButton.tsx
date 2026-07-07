"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearEngine } from "@/app/(app)/grid/actions";
import { engineSlug } from "@/lib/execution-grid";
import type { TargetEngine } from "@/lib/intelligence";

// Header action on an engine drill-down: permanently clears every workflow
// routed to this engine. Disabled when the pane is empty; confirms first.
export function ClearEngineButton({ engine, count }: { engine: TargetEngine; count: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (pending || count === 0) return;
    const ok = window.confirm(
      `Clear all ${count} workflow${count === 1 ? "" : "s"} routed to ${engine}? ` +
        "This permanently deletes them and everything they produced. This cannot be undone.",
    );
    if (!ok) return;
    startTransition(async () => {
      const res = await clearEngine(engineSlug(engine));
      if (res.ok) router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending || count === 0}
      className="shrink-0 rounded-full border border-status-danger/40 bg-status-danger/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-status-danger transition hover:bg-status-danger/20 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pending ? "Clearing…" : "Clear all"}
    </button>
  );
}
