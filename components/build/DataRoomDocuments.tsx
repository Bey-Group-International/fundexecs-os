"use client";

import { useState, useTransition } from "react";
import { inputClass } from "./DraftWithEarn";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import { addDocument } from "./materials-actions";

// Collapsible "add a document by link" form. No file upload — operators paste a
// shareable URL (Drive, Dropbox, etc.) and tag it to a section.
export function AddDocumentForm({ defaultSection }: { defaultSection?: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20 print:hidden"
      >
        <span className="font-mono text-base leading-none">+</span> Add document
      </button>
    );
  }

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          await addDocument(fd);
          setOpen(false);
        })
      }
      className="grid gap-3 rounded-xl border border-line bg-surface-1 p-4 sm:grid-cols-2 print:hidden"
    >
      <input name="name" required placeholder="Document name" className={`${inputClass} sm:col-span-2`} />
      <input
        name="url"
        type="url"
        required
        placeholder="https://link-to-document"
        className={inputClass}
      />
      <select name="section" defaultValue={defaultSection ?? "overview"} className={inputClass}>
        {DATA_ROOM_SECTIONS.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
      <div className="flex gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add"}
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
