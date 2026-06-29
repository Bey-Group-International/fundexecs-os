"use client";

// Inline contact edit panel — renders as a compact form that appears when
// the user clicks the pencil icon on a contact row. Saves via
// updateContactFieldsAction without navigating away.
import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { updateContactFieldsAction } from "@/app/(app)/[hub]/[module]/actions";
import type { ContactFields } from "@/app/(app)/[hub]/[module]/actions";

type ContactTable = "investors" | "deals" | "partners" | "service_providers" | "debt_facilities";

interface Props {
  table: ContactTable;
  id: string;
  initial: ContactFields;
  onClose: () => void;
  onSaved?: (fields: ContactFields) => void;
}

const inputCls =
  "w-full rounded border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-fg-primary placeholder:text-fg-muted/50 focus:border-gold-500/40 focus:outline-none";
const labelCls = "block font-mono text-[9px] uppercase tracking-widest text-fg-muted mb-0.5";

export function InlineContactEdit({ table, id, initial, onClose, onSaved }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [fields, setFields] = useState<ContactFields>(initial);
  const [saveError, setSaveError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector("input")?.focus();
  }, []);

  function set(k: keyof ContactFields, v: string) {
    setFields((f) => ({ ...f, [k]: v }));
  }

  function handleSave() {
    setSaveError(null);
    start(async () => {
      const result = await updateContactFieldsAction(table, id, fields);
      if (result.error) { setSaveError(result.error); return; }
      onSaved?.(fields);
      router.refresh();
      onClose();
    });
  }

  return (
    <div ref={ref} className="mt-2 rounded-xl border border-gold-500/20 bg-surface-2 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Contact Name</label>
          <input className={inputCls} value={fields.contact_name ?? ""} onChange={(e) => set("contact_name", e.target.value)} placeholder="Jane Smith" />
        </div>
        <div>
          <label className={labelCls}>Role</label>
          <input className={inputCls} value={fields.role ?? ""} onChange={(e) => set("role", e.target.value)} placeholder="Partner" />
        </div>
        <div>
          <label className={labelCls}>Email</label>
          <input className={inputCls} type="email" value={fields.contact_email ?? ""} onChange={(e) => set("contact_email", e.target.value)} placeholder="jane@firm.com" />
        </div>
        <div>
          <label className={labelCls}>Phone</label>
          <input className={inputCls} value={fields.contact_phone ?? ""} onChange={(e) => set("contact_phone", e.target.value)} placeholder="+1 212 555 0100" />
        </div>
        <div>
          <label className={labelCls}>Website</label>
          <input className={inputCls} value={fields.website ?? ""} onChange={(e) => set("website", e.target.value)} placeholder="firm.com" />
        </div>
        <div>
          <label className={labelCls}>Source URL</label>
          <input className={inputCls} value={fields.url_source ?? ""} onChange={(e) => set("url_source", e.target.value)} placeholder="https://…" />
        </div>
      </div>
      {saveError && (
        <p className="font-mono text-[10px] text-red-400">{saveError}</p>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="font-mono text-[9px] uppercase tracking-widest text-fg-muted hover:text-fg-primary">
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="rounded border border-gold-500/40 bg-gold-500/10 px-3 py-1 font-mono text-[9px] uppercase tracking-widest text-gold-300 hover:bg-gold-500/20 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// Pencil trigger button — shown in hover state on rows
export function EditContactBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title="Edit contact info"
      className="rounded border border-line px-1.5 py-0.5 font-mono text-[9px] text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300"
    >
      Edit
    </button>
  );
}
