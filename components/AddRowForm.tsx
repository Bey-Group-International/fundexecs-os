"use client";

import { useRef, useState } from "react";
import { createModuleRow } from "@/app/(app)/[hub]/[module]/actions";
import type { FieldConfig } from "@/lib/module-forms";

// Inline, collapsible "+ Add" form for a table-backed module. Posts to the
// createModuleRow server action, which validates against the same field config.
export default function AddRowForm({
  hub,
  module,
  fields,
}: {
  hub: string;
  module: string;
  fields: FieldConfig[];
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300"
      >
        + Add
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={async (formData: FormData) => {
        await createModuleRow(hub, module, formData);
        formRef.current?.reset();
        setOpen(false);
      }}
      className="mb-4 flex flex-col gap-4 rounded-xl border border-line bg-surface-1 p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.name} className="flex flex-col gap-1.5 text-sm">
            <span className="text-fg-secondary">
              {f.label}
              {f.required ? <span className="text-status-danger"> *</span> : null}
            </span>
            {f.type === "select" ? (
              <select
                name={f.name}
                defaultValue={typeof f.defaultValue === "string" ? f.defaultValue : f.options?.[0]}
                className="rounded-md border border-line bg-surface-0 px-3 py-2 text-fg-primary outline-none focus:border-gold-500"
              >
                {f.options?.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : f.type === "checkbox" ? (
              <input
                type="checkbox"
                name={f.name}
                defaultChecked={f.defaultValue === true}
                className="h-4 w-4 self-start accent-gold-400"
              />
            ) : (
              <input
                name={f.name}
                type={f.type === "number" ? "number" : "text"}
                step={f.type === "number" ? "any" : undefined}
                required={f.required}
                defaultValue={typeof f.defaultValue === "string" ? f.defaultValue : undefined}
                className="rounded-md border border-line bg-surface-0 px-3 py-2 text-fg-primary outline-none focus:border-gold-500"
              />
            )}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300"
        >
          Save
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
