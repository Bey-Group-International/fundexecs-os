"use client";

// Triggers the browser's native print dialog so an operator can print or
// save a clean one-pager of the current war room. Hidden on print itself.
export function PrintButton({ label = "Print / Export" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 print:hidden"
    >
      {label}
    </button>
  );
}
