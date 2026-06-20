"use client";

import { useRef, useState } from "react";
import { recordValuationMark } from "@/components/execute/actions";

interface AssetOption {
  id: string;
  name: string;
}

// Inline, collapsible form to record a fair-value mark on a holding. Posts to
// the recordValuationMark server action, which appends to the audit trail and
// rolls the value onto the asset as its current mark.
export default function RecordMarkForm({ assets }: { assets: AssetOption[] }) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  if (assets.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 inline-flex items-center gap-1.5 rounded-md border border-gold-500/40 bg-gold-500/10 px-3.5 py-2 text-sm font-medium text-gold-300 transition hover:bg-gold-500/20 hover:text-gold-200"
      >
        <span className="font-mono text-base leading-none">+</span>
        Record mark
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={async (fd: FormData) => {
        await recordValuationMark(fd);
        formRef.current?.reset();
        setOpen(false);
      }}
      className="mb-4 flex flex-col gap-4 rounded-xl border border-line bg-surface-1 p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-secondary">Holding <span className="text-status-danger">*</span></span>
          <select
            name="asset_id"
            required
            className="rounded-md border border-line bg-surface-0 px-3 py-2 text-fg-primary outline-none focus:border-gold-500"
          >
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-secondary">Fair value <span className="text-status-danger">*</span></span>
          <input
            name="value"
            type="number"
            step="any"
            required
            className="rounded-md border border-line bg-surface-0 px-3 py-2 text-fg-primary outline-none focus:border-gold-500"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-secondary">As of</span>
          <input
            name="as_of"
            type="date"
            className="rounded-md border border-line bg-surface-0 px-3 py-2 text-fg-primary outline-none focus:border-gold-500"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-secondary">Method</span>
          <input
            name="method"
            placeholder="e.g. DCF, comps, last round"
            className="rounded-md border border-line bg-surface-0 px-3 py-2 text-fg-primary outline-none focus:border-gold-500"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          <span className="text-fg-secondary">Note</span>
          <input
            name="note"
            placeholder="Rationale for the mark"
            className="rounded-md border border-line bg-surface-0 px-3 py-2 text-fg-primary outline-none focus:border-gold-500"
          />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300"
        >
          Save mark
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-line px-4 py-2 text-sm text-fg-secondary transition hover:bg-surface-2"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
