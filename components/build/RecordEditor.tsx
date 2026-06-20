"use client";

import { useState, type ReactNode } from "react";
import { inputClass } from "./DraftWithEarn";

// Wraps a server-rendered record row and reveals an inline edit form on demand.
// `display` is the read-only card/row (rendered on the server and passed in);
// `children` are the edit fields (pre-filled inputs). On Edit, the display is
// swapped for a <form> posting to the given update action; Cancel restores it.
export function RecordEditor({
  id,
  action,
  display,
  children,
  layout = "stacked",
}: {
  id: string;
  action: (formData: FormData) => Promise<void>;
  display: ReactNode;
  children: ReactNode;
  layout?: "stacked" | "grid";
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{display}</div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-md border border-line px-2 py-1 text-xs text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <form
      action={async (formData) => {
        await action(formData);
        setEditing(false);
      }}
      className={
        layout === "grid"
          ? "grid gap-3 sm:grid-cols-2"
          : "flex flex-col gap-3"
      }
    >
      <input type="hidden" name="id" value={id} />
      {children}
      <div className="flex gap-2 sm:col-span-2">
        <button className="rounded-md bg-gold-400 px-3 py-1.5 text-xs font-medium text-surface-0 transition hover:bg-gold-300">
          Save
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-md border border-line px-3 py-1.5 text-xs text-fg-secondary transition hover:text-fg-primary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// Convenience input that matches the shared field style.
export function EditInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

// Table-row variant: shows a server-rendered display row (with an Edit button
// in a trailing cell) and, when editing, swaps in a full-width edit form row.
export function TableRecordEditor({
  id,
  action,
  colCount,
  display,
  actions,
  children,
}: {
  id: string;
  action: (formData: FormData) => Promise<void>;
  colCount: number;
  display: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <tr className="border-b border-line/60 bg-surface-1 text-fg-secondary">
        {display}
        <td className="px-3 py-2 text-right">
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-line px-1.5 py-0.5 text-xs text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300"
            >
              Edit
            </button>
            {actions}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-line/60 bg-surface-1">
      <td colSpan={colCount} className="px-3 py-3">
        <form
          action={async (formData) => {
            await action(formData);
            setEditing(false);
          }}
          className="grid gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="id" value={id} />
          {children}
          <div className="flex gap-2 sm:col-span-2">
            <button className="rounded-md bg-gold-400 px-3 py-1.5 text-xs font-medium text-surface-0 transition hover:bg-gold-300">
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-line px-3 py-1.5 text-xs text-fg-secondary transition hover:text-fg-primary"
            >
              Cancel
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
}
