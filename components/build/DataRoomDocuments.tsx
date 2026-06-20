"use client";

import { useMemo, useState, useTransition } from "react";
import { inputClass } from "./DraftWithEarn";
import { DATA_ROOM_SECTIONS, KEY_MATERIALS, hasMaterial } from "@/lib/data-room";
import {
  addDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  moveDocument,
} from "./materials-actions";

export interface DocView {
  id: string;
  name: string;
  doc_type: string | null;
  storage_key: string | null;
  content: string | null;
  created_at: string | null;
}

const SECTION_LABEL = new Map(DATA_ROOM_SECTIONS.map((s) => [s.key, s.label]));

function SectionSelect({ defaultValue }: { defaultValue?: string }) {
  return (
    <select name="section" defaultValue={defaultValue ?? "overview"} className={inputClass}>
      {DATA_ROOM_SECTIONS.map((s) => (
        <option key={s.key} value={s.key}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// One document row: name + type icon + date, with open / expand / edit / reorder
// / delete. Edit reveals an inline form posting updateDocument.
function DocRow({ doc, isFirst, isLast }: { doc: DocView; isFirst: boolean; isLast: boolean }) {
  const [editing, setEditing] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const [pending, startTransition] = useTransition();
  const isLink = !!doc.storage_key;

  if (editing) {
    return (
      <form
        action={(fd) => startTransition(async () => { await updateDocument(fd); setEditing(false); })}
        className="grid gap-2 rounded-lg border border-line bg-surface-1 p-3 sm:grid-cols-2"
      >
        <input type="hidden" name="id" value={doc.id} />
        <input name="name" required defaultValue={doc.name} className={`${inputClass} sm:col-span-2`} />
        <SectionSelect defaultValue={doc.doc_type ?? "other"} />
        {isLink ? (
          <input name="url" type="url" defaultValue={doc.storage_key ?? ""} placeholder="https://…" className={inputClass} />
        ) : (
          <textarea name="content" rows={4} defaultValue={doc.content ?? ""} className={`${inputClass} sm:col-span-2`} />
        )}
        <div className="flex gap-2 sm:col-span-2">
          <button disabled={pending} className="rounded-md bg-gold-400 px-3 py-1.5 text-xs font-medium text-surface-0 hover:bg-gold-300 disabled:opacity-60">
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-line px-3 py-1.5 text-xs text-fg-secondary hover:text-fg-primary">
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface-1 px-3 py-2">
      <div className="flex items-center gap-2">
        <span aria-hidden className="font-mono text-xs text-fg-muted">{isLink ? "🔗" : "📄"}</span>
        <button
          type="button"
          onClick={() => doc.content && setShowContent((v) => !v)}
          className={`min-w-0 flex-1 truncate text-left text-sm text-fg-primary ${doc.content ? "hover:text-gold-300" : "cursor-default"}`}
        >
          {doc.name}
        </button>
        {doc.created_at ? (
          <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-wider text-fg-muted sm:inline">
            {fmtDate(doc.created_at)}
          </span>
        ) : null}
        {isLink ? (
          <a
            href={doc.storage_key ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-gold-400 hover:underline"
          >
            Open →
          </a>
        ) : null}
        {/* Reorder */}
        <form action={moveDocument} className="shrink-0">
          <input type="hidden" name="id" value={doc.id} />
          <input type="hidden" name="dir" value="up" />
          <button disabled={isFirst} className="rounded border border-line px-1 text-xs text-fg-muted hover:text-fg-primary disabled:opacity-30" aria-label="Move up">↑</button>
        </form>
        <form action={moveDocument} className="shrink-0">
          <input type="hidden" name="id" value={doc.id} />
          <input type="hidden" name="dir" value="down" />
          <button disabled={isLast} className="rounded border border-line px-1 text-xs text-fg-muted hover:text-fg-primary disabled:opacity-30" aria-label="Move down">↓</button>
        </form>
        <button type="button" onClick={() => setEditing(true)} className="shrink-0 rounded border border-line px-1.5 py-0.5 text-xs text-fg-muted hover:border-gold-500/40 hover:text-gold-300">
          Edit
        </button>
        <form action={deleteDocument} className="shrink-0">
          <input type="hidden" name="id" value={doc.id} />
          <button className="rounded border border-line px-1.5 py-0.5 text-xs text-fg-muted hover:border-red-500/40 hover:text-red-400">✕</button>
        </form>
      </div>
      {showContent && doc.content ? (
        <p className="mt-2 whitespace-pre-wrap border-t border-line pt-2 text-xs leading-snug text-fg-secondary">{doc.content}</p>
      ) : null}
    </div>
  );
}

// Full document library: search, add-by-link, create-in-app, and a grouped,
// reorderable, editable list.
export function DocumentLibrary({ documents }: { documents: DocView[] }) {
  const [mode, setMode] = useState<null | "link" | "create">(null);
  const [query, setQuery] = useState("");
  const [prefill, setPrefill] = useState<{ name: string; section: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const docNames = useMemo(() => documents.map((d) => d.name), [documents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? documents.filter((d) => d.name.toLowerCase().includes(q)) : documents;
  }, [documents, query]);

  const grouped = useMemo(() => {
    const m = new Map<string, DocView[]>();
    for (const d of filtered) {
      const k = d.doc_type ?? "other";
      const b = m.get(k);
      if (b) b.push(d);
      else m.set(k, [d]);
    }
    return m;
  }, [filtered]);

  return (
    <div className="mx-auto mt-8 max-w-2xl print:hidden">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-display text-lg font-semibold tracking-tight text-fg-primary">Documents</h3>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className={`${inputClass} h-8 w-32 py-1`}
          />
          <button
            type="button"
            onClick={() => setMode(mode === "link" ? null : "link")}
            className="rounded-md border border-gold-500/40 bg-gold-500/10 px-2.5 py-1.5 text-xs font-medium text-gold-300 hover:bg-gold-500/20"
          >
            + Link
          </button>
          <button
            type="button"
            onClick={() => { setPrefill(null); setMode(mode === "create" ? null : "create"); }}
            className="rounded-md border border-gold-500/40 bg-gold-500/10 px-2.5 py-1.5 text-xs font-medium text-gold-300 hover:bg-gold-500/20"
          >
            + Create
          </button>
        </div>
      </div>

      {/* Key materials — one-click presets for core fundraising collateral */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted">Key materials</span>
        {KEY_MATERIALS.map((m) => {
          const present = hasMaterial(m, docNames);
          return (
            <button
              key={m.name}
              type="button"
              disabled={present}
              onClick={() => { setPrefill({ name: m.name, section: m.section }); setMode("create"); }}
              title={present ? `${m.name} is in the room` : `Create ${m.name}`}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${
                present
                  ? "border-emerald-400/40 text-emerald-300"
                  : "border-line text-fg-secondary hover:border-gold-500/40 hover:text-gold-300"
              }`}
            >
              <span className="font-mono text-[10px]">{present ? "✓" : "+"}</span>
              {m.name}
            </button>
          );
        })}
      </div>

      {mode === "link" ? (
        <form
          action={(fd) => startTransition(async () => { await addDocument(fd); setMode(null); })}
          className="mb-4 grid gap-3 rounded-xl border border-line bg-surface-1 p-4 sm:grid-cols-2"
        >
          <input name="name" required placeholder="Document name" className={`${inputClass} sm:col-span-2`} />
          <input name="url" type="url" required placeholder="https://link-to-document" className={inputClass} />
          <SectionSelect />
          <div className="sm:col-span-2">
            <button disabled={pending} className="rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 hover:bg-gold-300 disabled:opacity-60">
              {pending ? "Adding…" : "Add link"}
            </button>
          </div>
        </form>
      ) : null}

      {mode === "create" ? (
        <form
          key={prefill?.name ?? "blank"}
          action={(fd) => startTransition(async () => { await createDocument(fd); setMode(null); setPrefill(null); })}
          className="mb-4 grid gap-3 rounded-xl border border-line bg-surface-1 p-4 sm:grid-cols-2"
        >
          <input name="name" required defaultValue={prefill?.name} placeholder="Document name" className={`${inputClass} sm:col-span-2`} />
          <SectionSelect defaultValue={prefill?.section} />
          <textarea name="content" required rows={5} placeholder="Write the document…" className={`${inputClass} sm:col-span-2`} />
          <div className="sm:col-span-2">
            <button disabled={pending} className="rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 hover:bg-gold-300 disabled:opacity-60">
              {pending ? "Creating…" : "Create document"}
            </button>
          </div>
        </form>
      ) : null}

      {documents.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-1 px-4 py-8 text-center text-sm text-fg-muted">
          No documents yet. Add a link or create one in-app to build out the room.
        </p>
      ) : filtered.length === 0 ? (
        <p className="px-1 py-4 text-sm text-fg-muted">No documents match “{query}”.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {DATA_ROOM_SECTIONS.map((s) => {
            const docs = grouped.get(s.key);
            if (!docs?.length) return null;
            return (
              <div key={s.key}>
                <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-gold-400">
                  {SECTION_LABEL.get(s.key) ?? s.key}
                </p>
                <div className="flex flex-col gap-1.5">
                  {docs.map((d, i) => (
                    <DocRow key={d.id} doc={d} isFirst={i === 0} isLast={i === docs.length - 1} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
