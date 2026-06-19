"use client";

// Triggers the browser print dialog (Save as PDF) for the investor one-pager.
// The print stylesheet on the page hides app chrome so the sheet exports clean.
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20 print:hidden"
    >
      ⤓ Export PDF
    </button>
  );
}
