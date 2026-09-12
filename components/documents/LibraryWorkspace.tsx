"use client";

// Documents › Library, shaped the way an operator actually works through a
// document set: a persistent index on the left, one table on the right.
//
// It deliberately mirrors the data room's workspace (components/build/
// RoomWorkspace), because the two are halves of one job — this is where a
// document is made and held, that is where it is shown — and an operator moving
// between them should not have to relearn the furniture. The difference is what
// each pane is for: the room curates what a reader sees, this one carries
// everything the firm has, including the drafts no one will ever see.
//
// The accordion this replaced listed sixteen collapsed sections and nothing
// else. Finding one document meant opening sections until it appeared, and
// there was no way to see a file's type, size, or age at all — none of which
// the product had, because until now a document could not BE a file.
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { addDocument, newDocument } from "./document-actions";
import { removeDocumentFile } from "./upload-actions";
import { DocumentUploader, ReplaceFileButton } from "./DocumentUploader";
import {
  PublishControl,
  QualityBadges,
  StatusCycler,
  type LibraryDoc,
  type LibraryRoom,
  type LibrarySection,
} from "./LibraryControls";
import { DeleteDocumentButton } from "@/components/build/DeleteDocumentButton";
import { GenerateAiButton } from "@/components/build/GenerateAiButton";
import { formatBytes } from "@/lib/document-files";

type SortKey = "section" | "name" | "updated" | "size";

/** A document nobody can read: no file, no link, no written content. */
function isEmpty(doc: LibraryDoc): boolean {
  return !doc.storageKey && !doc.hasContent;
}

export function LibraryWorkspace({
  sections,
  rooms,
}: {
  sections: LibrarySection[];
  rooms: LibraryRoom[];
}) {
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<string | null>(null);
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [sort, setSort] = useState<SortKey>("section");
  const [linking, setLinking] = useState(false);
  const [pending, startTransition] = useTransition();

  // Readiness deep-links here as /build/documents#section-<key> (see
  // lib/build-readiness). The rail button carries that id so SectionHighlighter
  // can flash it, but flashing a button the operator then has to press is half
  // an answer — select the section too, so the link lands on the documents it
  // was pointing at.
  useEffect(() => {
    const select = () => {
      const hash = window.location.hash;
      if (!hash.startsWith("#section-")) return;
      const key = hash.slice("#section-".length);
      if (sections.some((s) => s.key === key)) setSection(key);
    };
    select();
    window.addEventListener("hashchange", select);
    return () => window.removeEventListener("hashchange", select);
  }, [sections]);

  const sectionOrder = useMemo(
    () => new Map(sections.map((s, i) => [s.key, i])),
    [sections],
  );
  const sectionLabel = useMemo(
    () => new Map(sections.map((s) => [s.key, s.label])),
    [sections],
  );

  const allDocs = useMemo(() => sections.flatMap((s) => s.docs), [sections]);
  const emptyCount = useMemo(() => allDocs.filter(isEmpty).length, [allDocs]);

  // Filters narrow the table only. The rail keeps the library's true counts, so
  // a search never makes the firm look like it holds less than it does.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = allDocs.filter((d) => {
      if (section && d.section !== section) return false;
      if (onlyEmpty && !isEmpty(d)) return false;
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        (sectionLabel.get(d.section) ?? "").toLowerCase().includes(q) ||
        d.kind.toLowerCase().includes(q)
      );
    });
    const by: Record<SortKey, (a: LibraryDoc, b: LibraryDoc) => number> = {
      section: (a, b) =>
        (sectionOrder.get(a.section) ?? 99) - (sectionOrder.get(b.section) ?? 99) ||
        a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      size: (a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1),
    };
    return [...filtered].sort(by[sort]);
  }, [allDocs, query, section, onlyEmpty, sort, sectionOrder, sectionLabel]);

  const filtering = Boolean(query.trim()) || section !== null || onlyEmpty;
  const current = section ? sections.find((s) => s.key === section) ?? null : null;
  // With no section chosen, new material lands in the catch-all rather than
  // silently in whichever section happened to be first.
  const targetSection = current?.key ?? "other";
  const targetLabel = current?.label ?? "Other Materials";
  const sharedCount = allDocs.filter((d) => d.roomIds.length > 0).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* ---------------------------------------------------------------- Rail */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div
          className="rounded-2xl border border-line bg-surface-1"
          style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.15)" }}
        >
          <div className="border-b border-line px-4 py-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">Library</p>
            <p className="mt-1 font-display text-2xl font-semibold leading-none text-fg-primary">
              {allDocs.length}
            </p>
            <p className="mt-1 font-mono text-[11px] text-fg-muted">
              {sharedCount} published · {allDocs.length - sharedCount} private
            </p>
          </div>

          <div className="border-b border-line px-3 py-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search documents…"
              aria-label="Search documents"
              className="w-full rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
            />
            {emptyCount > 0 ? (
              <button
                type="button"
                onClick={() => setOnlyEmpty((v) => !v)}
                aria-pressed={onlyEmpty}
                title="Documents with no file, no link, and nothing written — nothing for a reader to open"
                className={`mt-2 w-full rounded-lg border px-2.5 py-1.5 text-left font-mono text-[11px] uppercase tracking-wider transition ${
                  onlyEmpty
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                    : "border-line text-fg-muted hover:border-amber-500/30 hover:text-amber-400"
                }`}
              >
                Nothing to open · {emptyCount}
              </button>
            ) : null}
          </div>

          <nav className="flex max-h-[24rem] flex-col gap-0.5 overflow-y-auto p-2">
            <button
              type="button"
              onClick={() => setSection(null)}
              aria-current={section === null}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                section === null
                  ? "bg-surface-0 font-medium text-fg-primary"
                  : "text-fg-secondary hover:bg-surface-0/60 hover:text-fg-primary"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">All documents</span>
              <span className="shrink-0 font-mono text-[11px] text-fg-muted">{allDocs.length}</span>
            </button>

            {sections.map((s) => {
              const active = section === s.key;
              const flagged = s.docs.filter(isEmpty).length;
              return (
                <button
                  key={s.key}
                  id={`section-${s.key}`}
                  type="button"
                  onClick={() => setSection(active ? null : s.key)}
                  aria-current={active}
                  title={s.description}
                  className={`flex scroll-mt-24 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                    active
                      ? "bg-surface-0 font-medium text-fg-primary"
                      : "text-fg-secondary hover:bg-surface-0/60 hover:text-fg-primary"
                  }`}
                  style={active ? { borderLeft: "2px solid #D4AF6A", paddingLeft: "10px" } : undefined}
                >
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  {flagged > 0 ? (
                    <span
                      title={`${flagged} document${flagged > 1 ? "s" : ""} with nothing to open`}
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
                    />
                  ) : null}
                  {s.docs.length === 0 && s.viaBuild ? (
                    <span
                      title="Covered by your Build foundation"
                      className="shrink-0 font-mono text-[11px] text-sky-400"
                    >
                      B
                    </span>
                  ) : null}
                  <span className="shrink-0 font-mono text-[11px] text-fg-muted">
                    {s.docs.length}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="border-t border-line px-3 py-3">
            <Link
              href="/build/data_room"
              className="font-mono text-[11px] uppercase tracking-wider text-gold-300 hover:underline"
            >
              Data rooms →
            </Link>
            <p className="mt-1 text-[11px] leading-snug text-fg-muted">
              Nothing here is visible outside the firm until it is published into a room.
            </p>
          </div>
        </div>
      </aside>

      {/* ---------------------------------------------------------------- Pane */}
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-semibold tracking-tight text-fg-primary">
              {current ? current.label : "All documents"}
            </h3>
            <p className="mt-0.5 text-xs text-fg-muted">
              {filtering
                ? `${rows.length} of ${allDocs.length} shown`
                : (current?.description ?? "Everything your firm holds and creates.")}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {current?.aiDraftable && current.docs.length === 0 ? (
              <GenerateAiButton sectionKey={current.key} />
            ) : null}
            <button
              type="button"
              onClick={() => setLinking((v) => !v)}
              aria-expanded={linking}
              title="File a document that lives elsewhere — Drive, Dropbox, a signed PDF"
              className="rounded-lg border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-fg-secondary transition hover:border-gold-500/40 hover:text-gold-300"
            >
              + Link
            </button>
            <form
              action={(fd) =>
                startTransition(async () => {
                  await newDocument(fd);
                })
              }
            >
              <input type="hidden" name="section" value={targetSection} />
              <button
                type="submit"
                disabled={pending}
                title={`Write a new document in ${targetLabel}`}
                className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
              >
                {pending ? "…" : "+ New"}
              </button>
            </form>
          </div>
        </div>

        {linking ? (
          <form
            action={(fd) =>
              startTransition(async () => {
                await addDocument(fd);
                setLinking(false);
              })
            }
            className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-1 px-4 py-3"
          >
            <input type="hidden" name="section" value={targetSection} />
            <input
              name="name"
              required
              placeholder="Document name"
              className="min-w-[10rem] flex-1 rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
            />
            <input
              name="url"
              type="url"
              required
              placeholder="https://…"
              className="min-w-[12rem] flex-[2] rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
            >
              {pending ? "Adding…" : "Add link"}
            </button>
          </form>
        ) : null}

        <div className="mb-3">
          <DocumentUploader section={targetSection} sectionLabel={targetLabel} />
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-surface-0 px-4 py-10 text-center">
            <p className="text-sm text-fg-secondary">
              {filtering ? "No documents match." : "Nothing filed here yet."}
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              {filtering
                ? "Clear the filters to see the whole library."
                : "Drop a file above, link one that lives elsewhere, or write a new one."}
            </p>
            {filtering ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setSection(null);
                  setOnlyEmpty(false);
                }}
                className="mt-3 font-mono text-[11px] uppercase tracking-wider text-gold-300 hover:underline"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface-0">
            <table className="w-full min-w-[56rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[11px] uppercase tracking-wider text-fg-muted">
                  <SortHeader label="Document" value="name" sort={sort} onSort={setSort} />
                  {section === null ? (
                    <SortHeader label="Section" value="section" sort={sort} onSort={setSort} />
                  ) : null}
                  <th scope="col" className="px-3 py-2 font-normal">Kind</th>
                  <SortHeader label="Size" value="size" sort={sort} onSort={setSort} align="right" />
                  <th scope="col" className="px-3 py-2 font-normal">Quality</th>
                  <th scope="col" className="px-3 py-2 font-normal">Status</th>
                  <th scope="col" className="px-3 py-2 font-normal">Sharing</th>
                  <SortHeader label="Updated" value="updated" sort={sort} onSort={setSort} />
                  <th scope="col" className="px-3 py-2 font-normal">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="border-b border-line/50 last:border-0 hover:bg-surface-1/60">
                    <td className="px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          title={d.uploaded ? "Uploaded file" : d.storageKey ? "External link" : "Written here"}
                          className="shrink-0 font-mono text-[11px] text-fg-muted"
                        >
                          {d.uploaded ? "▤" : d.storageKey ? "↗" : "≡"}
                        </span>
                        <Link
                          href={`/document/${d.id}`}
                          className="min-w-0 truncate text-fg-secondary transition hover:text-gold-300"
                        >
                          {d.name}
                        </Link>
                      </div>
                    </td>
                    {section === null ? (
                      <td className="px-3 py-2 text-xs text-fg-muted">
                        {sectionLabel.get(d.section) ?? "Other Materials"}
                      </td>
                    ) : null}
                    <td className="px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
                      {d.kind}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[11px] text-fg-muted">
                      {d.sizeBytes != null ? formatBytes(d.sizeBytes) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <QualityBadges doc={d} />
                    </td>
                    <td className="px-3 py-2">
                      <StatusCycler doc={d} />
                    </td>
                    <td className="px-3 py-2">
                      <PublishControl doc={d} rooms={rooms} />
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-fg-muted">{d.updatedLabel}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        {d.storageKey ? (
                          <a
                            href={`/api/documents/${d.id}/file`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={d.uploaded ? "Open the file" : "Open the linked document"}
                            className="shrink-0 rounded-lg border border-line px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300"
                          >
                            Open
                          </a>
                        ) : null}
                        <ReplaceFileButton
                          documentId={d.id}
                          section={d.section}
                          hasFile={d.uploaded}
                        />
                        {d.uploaded ? (
                          <form
                            action={(fd) =>
                              startTransition(async () => {
                                await removeDocumentFile(fd);
                              })
                            }
                          >
                            <input type="hidden" name="id" value={d.id} />
                            <button
                              type="submit"
                              title="Detach the file — the document, its name and anything written stay"
                              className="shrink-0 rounded-lg border border-line px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted transition hover:border-red-500/40 hover:text-red-400"
                            >
                              Detach
                            </button>
                          </form>
                        ) : null}
                        <DeleteDocumentButton id={d.id} name={d.name} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {current && current.docs.length === 0 && current.viaBuild ? (
          <p className="mt-3 text-xs text-fg-muted">
            Covered by your Build foundation — add a document here when you want a written version
            LPs can read.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SortHeader({
  label,
  value,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  value: SortKey;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort === value;
  return (
    <th
      scope="col"
      className={`px-3 py-2 font-normal ${align === "right" ? "text-right" : ""}`}
      aria-sort={active ? "descending" : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(value)}
        className={`font-mono text-[11px] uppercase tracking-wider transition hover:text-gold-300 ${
          active ? "text-gold-300" : "text-fg-muted"
        }`}
      >
        {label}
        {active ? " ·" : ""}
      </button>
    </th>
  );
}
