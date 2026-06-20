"use client";

import { useRef, useState, useTransition } from "react";
import { setThesisFit } from "@/components/run/strategy-actions";

const PRESETS = [25, 50, 75, 100] as const;

/**
 * Compact, server-action-driven thesis-fit control on a Strategy deal row. The
 * operator can drag the range or tap a preset; either way it submits the
 * enclosing form to `setThesisFit`, which persists a 0..1 fraction and
 * revalidates the Strategy surface. Local state only mirrors the slider so the
 * label tracks the drag before the round-trip lands.
 */
export function StrategyFitControl({
  dealId,
  value,
}: {
  dealId: string;
  value: number | null;
}) {
  const initial = value != null ? Math.round(value * 100) : 50;
  const [pct, setPct] = useState(initial);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(next: number) {
    setPct(next);
    if (inputRef.current) inputRef.current.value = String(next);
    startTransition(() => {
      formRef.current?.requestSubmit();
    });
  }

  return (
    <form
      ref={formRef}
      action={setThesisFit}
      // Stop the row-level <Link> from navigating when interacting with the control.
      onClick={(e) => e.stopPropagation()}
      className={`flex items-center gap-2 ${pending ? "opacity-60" : ""}`}
    >
      <input type="hidden" name="deal_id" value={dealId} />
      <input ref={inputRef} type="hidden" name="thesis_fit" defaultValue={String(initial)} />
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        onChange={(e) => setPct(Number(e.target.value))}
        onMouseUp={(e) => submit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => submit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => submit(Number((e.target as HTMLInputElement).value))}
        aria-label="Thesis fit"
        className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-line accent-gold-400"
      />
      <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-fg-secondary">
        {pct}%
      </span>
      <div className="flex items-center gap-0.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => submit(p)}
            className={`rounded border px-1.5 py-0.5 font-mono text-[9px] transition ${
              pct === p
                ? "border-gold-500/50 bg-gold-500/10 text-gold-300"
                : "border-line text-fg-muted hover:border-gold-500/40 hover:text-gold-300"
            }`}
          >
            {p}
          </button>
        ))}
      </div>
    </form>
  );
}
