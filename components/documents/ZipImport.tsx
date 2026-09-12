"use client";

// Reviewing a zip before any of it becomes a document.
//
// The archive's folders are read as the filing they already are and proposed
// back — but proposed, not applied. A diligence pack is somebody else's
// organisation of somebody else's material, and the operator is the only one
// who knows whether `Legal/` means their legal section or counsel's working
// folder. So every row shows where it would land and can be re-filed or
// dropped, and nothing is uploaded until Import.
//
// The whole review runs off the ZIP central directory. No entry is inflated
// until the operator commits, which is what lets a 200 MB archive be examined
// without decompressing 200 MB.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import { MAX_UPLOAD_BYTES, formatBytes } from "@/lib/document-files";
import {
  MAX_ZIP_BYTES,
  MAX_ZIP_ENTRIES,
  describePlan,
  planZipImport,
  type ZipPlan,
  type ZipPlanItem,
} from "@/lib/document-zip";
import { ZipError, createBudget, readZipEntries, readZipEntry, type ZipEntry } from "@/lib/zip";
import { uploadDocumentFile } from "./DocumentUploader";

type Phase = "reading" | "review" | "importing" | "done" | "error";

const ZIP_MESSAGE: Record<string, string> = {
  "not-zip": "That file isn't a readable zip archive.",
  zip64: "That archive uses ZIP64, which isn't supported. Re-zip it with standard compression.",
  truncated: "That archive looks truncated — the download may not have finished.",
  "bad-header": "That archive is corrupt and can't be read.",
  "unsupported-method": "That archive uses a compression method we can't read.",
  "too-large": "That archive expands too large to process safely.",
  "no-decompressor": "This browser can't read compressed archives.",
};

function messageFor(err: unknown): string {
  if (err instanceof ZipError) return ZIP_MESSAGE[err.code] ?? "That archive can't be read.";
  return "That archive can't be read.";
}

export function ZipImport({
  file,
  defaultSection,
  onClose,
}: {
  file: File;
  defaultSection: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [phase, setPhase] = useState<Phase>("reading");
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<ZipPlan | null>(null);
  const [sections, setSections] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: [] as string[] });

  // The archive bytes and its directory, held for the life of the dialog: the
  // review works off the directory, and Import reads entries out of the same
  // buffer one at a time rather than inflating everything up front.
  const viewRef = useRef<DataView | null>(null);
  const entriesRef = useRef<Map<string, ZipEntry>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (file.size > MAX_ZIP_BYTES) {
        setError(`That archive is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_ZIP_BYTES)}.`);
        setPhase("error");
        return;
      }
      try {
        const buffer = await file.arrayBuffer();
        if (cancelled) return;
        const view = new DataView(buffer);
        const entries = readZipEntries(view);
        viewRef.current = view;
        entriesRef.current = new Map(entries.map((e) => [e.name, e]));
        const next = planZipImport(entries, { defaultSection });
        setPlan(next);
        setSections(Object.fromEntries(next.items.map((i) => [i.path, i.section])));
        setPhase("review");
      } catch (err) {
        if (cancelled) return;
        setError(messageFor(err));
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, defaultSection]);

  const included = useMemo(
    () => (plan?.items ?? []).filter((i) => !excluded.has(i.path)),
    [plan, excluded],
  );

  const runImport = useCallback(async () => {
    const view = viewRef.current;
    if (!view || included.length === 0) return;
    setPhase("importing");
    setProgress({ done: 0, total: included.length, failed: [] });

    const failed: string[] = [];
    for (let i = 0; i < included.length; i += 1) {
      const item = included[i];
      const entry = entriesRef.current.get(item.path);
      if (!entry) {
        failed.push(`${item.name} — missing from the archive`);
      } else {
        try {
          // A fresh budget per entry: no single file may exceed the upload
          // ceiling, and each is discarded before the next is read, so peak
          // memory stays at one document rather than the whole archive.
          const bytes = await readZipEntry(view, entry, createBudget(MAX_UPLOAD_BYTES));
          const base = item.path.split("/").pop() ?? item.name;
          const entryFile = new File([bytes as BlobPart], base);
          const result = await uploadDocumentFile(supabase, {
            file: entryFile,
            section: sections[item.path] ?? item.section,
          });
          if (!result.ok) failed.push(`${item.name} — ${result.error}`);
        } catch (err) {
          failed.push(`${item.name} — ${messageFor(err)}`);
        }
      }
      setProgress({ done: i + 1, total: included.length, failed: [...failed] });
    }

    setPhase("done");
    if (failed.length < included.length) router.refresh();
  }, [included, sections, supabase, router]);

  const grouped = useMemo(() => {
    const by = new Map<string, ZipPlanItem[]>();
    for (const item of plan?.items ?? []) {
      const key = sections[item.path] ?? item.section;
      const bucket = by.get(key);
      if (bucket) bucket.push(item);
      else by.set(key, [item]);
    }
    return [...by.entries()].sort(
      (a, b) =>
        DATA_ROOM_SECTIONS.findIndex((s) => s.key === a[0]) -
        DATA_ROOM_SECTIONS.findIndex((s) => s.key === b[0]),
    );
  }, [plan, sections]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Import ${file.name}`}
        className="w-full max-w-3xl rounded-2xl border border-line bg-surface-0"
        style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.4)" }}
      >
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">
              Import archive
            </p>
            <h2 className="mt-0.5 truncate font-display text-lg font-semibold tracking-tight text-fg-primary">
              {file.name}
            </h2>
            <p className="mt-0.5 text-xs text-fg-muted">
              {phase === "reading"
                ? "Reading the archive…"
                : plan
                  ? `${describePlan(plan)} · ${formatBytes(file.size)} archive`
                  : formatBytes(file.size)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg border border-line px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted transition hover:text-fg-primary"
          >
            ✕
          </button>
        </header>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {phase === "error" ? <p className="text-sm text-red-300">{error}</p> : null}

          {phase === "reading" ? (
            <p className="py-6 text-center text-sm text-fg-muted">Reading the archive…</p>
          ) : null}

          {(phase === "review" || phase === "importing") && plan ? (
            <>
              {plan.items.length === 0 ? (
                <p className="py-6 text-center text-sm text-fg-secondary">
                  Nothing in this archive can be filed as a document.
                </p>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <p className="text-xs text-fg-muted">
                      {included.length} of {plan.items.length} selected
                    </p>
                    <button
                      type="button"
                      disabled={phase === "importing"}
                      onClick={() =>
                        setExcluded(
                          excluded.size === 0 ? new Set(plan.items.map((i) => i.path)) : new Set(),
                        )
                      }
                      className="ml-auto font-mono text-[11px] uppercase tracking-wider text-fg-muted transition hover:text-gold-300 disabled:opacity-50"
                    >
                      {excluded.size === 0 ? "Deselect all" : "Select all"}
                    </button>
                  </div>

                  {grouped.map(([sectionKey, items]) => (
                    <section key={sectionKey} className="mb-4">
                      {/* A real heading: these groups are the structure of the
                          proposal, and a screen reader should be able to move
                          between them. */}
                      <h3 className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                        {DATA_ROOM_SECTIONS.find((s) => s.key === sectionKey)?.label ?? sectionKey}
                        <span className="ml-2 text-fg-muted/70">{items.length}</span>
                      </h3>
                      <div className="flex flex-col gap-1">
                        {items.map((item) => {
                          const on = !excluded.has(item.path);
                          return (
                            <div
                              key={item.path}
                              className="flex flex-wrap items-center gap-2 rounded-lg border border-line/60 bg-surface-1 px-3 py-2"
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={phase === "importing"}
                                aria-label={`Import ${item.name}`}
                                onChange={() =>
                                  setExcluded((prev) => {
                                    const next = new Set(prev);
                                    if (on) next.add(item.path);
                                    else next.delete(item.path);
                                    return next;
                                  })
                                }
                                className="h-3.5 w-3.5 shrink-0 accent-gold-400"
                              />
                              <span
                                className={`min-w-0 flex-1 truncate text-sm ${on ? "text-fg-secondary" : "text-fg-muted line-through"}`}
                                title={item.path}
                              >
                                {item.name}
                              </span>
                              {!item.matchedFolder ? (
                                <span
                                  title="No folder in the archive named a section — this is the fallback"
                                  className="shrink-0 rounded-full border border-amber-500/30 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-amber-400"
                                >
                                  Guessed
                                </span>
                              ) : null}
                              <span className="shrink-0 font-mono text-[11px] text-fg-muted">
                                {formatBytes(item.sizeBytes)}
                              </span>
                              <select
                                value={sections[item.path] ?? item.section}
                                disabled={phase === "importing"}
                                aria-label={`Section for ${item.name}`}
                                onChange={(e) =>
                                  setSections((prev) => ({ ...prev, [item.path]: e.target.value }))
                                }
                                className="shrink-0 rounded-md border border-line bg-surface-0 px-2 py-1 text-xs text-fg-secondary focus:border-gold-500/60 focus:outline-none"
                              >
                                {DATA_ROOM_SECTIONS.map((s) => (
                                  <option key={s.key} value={s.key}>
                                    {s.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </>
              )}

              {plan.truncated ? (
                <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
                  This archive holds more than {MAX_ZIP_ENTRIES} files. Only the first{" "}
                  {MAX_ZIP_ENTRIES} are listed — import these, then upload the rest separately.
                </p>
              ) : null}

              {plan.skipped.length > 0 ? (
                <details className="mt-2 rounded-lg border border-line bg-surface-1 px-3 py-2">
                  <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-wider text-fg-muted">
                    {plan.skipped.length} file{plan.skipped.length === 1 ? "" : "s"} skipped
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1">
                    {plan.skipped.map((s) => (
                      <li key={s.path} className="text-xs text-fg-muted">
                        <span className="text-fg-secondary">{s.path}</span> — {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : null}

          {phase === "done" ? (
            <div>
              <p className="text-sm text-fg-secondary">
                Imported {progress.done - progress.failed.length} of {progress.total} documents.
              </p>
              {progress.failed.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
                  {progress.failed.map((f) => (
                    <li key={f} className="text-xs text-red-300">
                      {f}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          {phase === "importing" ? (
            <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
              Importing {progress.done} / {progress.total}…
            </p>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={phase === "importing"}
              className="rounded-lg border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-fg-secondary transition hover:text-fg-primary disabled:opacity-50"
            >
              {phase === "done" ? "Close" : "Cancel"}
            </button>
            {phase === "review" && (plan?.items.length ?? 0) > 0 ? (
              <button
                type="button"
                onClick={runImport}
                disabled={included.length === 0}
                className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
              >
                Import {included.length} document{included.length === 1 ? "" : "s"}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
