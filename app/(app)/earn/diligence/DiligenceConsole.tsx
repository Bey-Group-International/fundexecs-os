"use client";

import { useMemo, useState, useTransition } from "react";
import { DILIGENCE_PRESETS } from "@/lib/brains/diligence";
import type { DiligenceResponse } from "@/lib/brains/types";
import { createClient } from "@/lib/supabase/client";
import { uploadDocumentFile } from "@/components/documents/DocumentUploader";
import type { UploadAllowance } from "@/lib/document-files";
import { askDiligence, readLibraryDocument } from "../actions";

const TEXT_EXTS = /\.(txt|md|markdown|csv)$/i;
const BINARY_ACCEPT = ".pdf,.docx,.xlsx,.pptx";

// Upload/paste/pick a document, pick a preset question, and run the routed
// Brain. Renders the deliverable plus an audit strip (Brain, tools used,
// reasoning).
//
// Text files are read in the browser. PDF and Office files can't be, so they
// are saved privately to the Documents library (where Earn's extractor reads
// them server-side) and the extracted text comes back here.
export function DiligenceConsole({
  library = [],
  allowance,
}: {
  library?: { id: string; name: string }[];
  allowance?: UploadAllowance;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [docName, setDocName] = useState("");
  const [docText, setDocText] = useState("");
  const [presetId, setPresetId] = useState(DILIGENCE_PRESETS[0].id);
  const [result, setResult] = useState<DiligenceResponse | null>(null);
  const [pending, startTransition] = useTransition();

  async function loadFromLibrary(id: string) {
    if (!id) return;
    setLoadError(null);
    setLoading("Reading the document…");
    const res = await readLibraryDocument(id);
    setLoading(null);
    if (res.ok) {
      setDocName(res.name);
      setDocText(res.text);
    } else setLoadError(res.error);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setLoadError(null);
    if (TEXT_EXTS.test(file.name)) {
      setDocName(file.name);
      setDocText(await file.text());
      return;
    }
    setLoading(`Uploading ${file.name}…`);
    const up = await uploadDocumentFile(supabase, {
      file,
      section: "other",
      allowance,
      onProgress: (f) => setLoading(`Uploading ${file.name}… ${Math.round(f * 100)}%`),
    });
    if (!up.ok) {
      setLoading(null);
      setLoadError(up.error);
      return;
    }
    await loadFromLibrary(up.documentId);
  }

  function run() {
    setResult(null);
    startTransition(async () => {
      const res = await askDiligence({ presetId, docName, docText });
      setResult(res);
    });
  }

  const canRun = docText.trim().length > 0 && !pending;

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-line bg-surface-1 p-5">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-secondary">Document name</span>
          <input
            value={docName}
            onChange={(e) => setDocName(e.target.value)}
            placeholder="Cedar Ridge — CIM"
            className="rounded-md border border-line bg-surface-0 px-3 py-2 text-fg-primary outline-none focus:border-gold-500"
          />
        </label>

        <label className="mt-4 flex flex-col gap-1.5 text-sm">
          <span className="flex items-center justify-between text-fg-secondary">
            <span>Paste the document text</span>
            <span className="font-mono text-[11px] text-fg-muted">
              or{" "}
              <label className="cursor-pointer text-gold-300 hover:underline">
                upload a file (PDF, Word, Excel, PowerPoint, text)
                <input
                  type="file"
                  accept={`${BINARY_ACCEPT},.txt,.md,.markdown,.csv,text/plain`}
                  className="hidden"
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
              </label>
            </span>
          </span>
          {library.length > 0 ? (
            <select
              value=""
              onChange={(e) => void loadFromLibrary(e.target.value)}
              aria-label="Pick a document from your library"
              className="rounded-md border border-line bg-surface-0 px-3 py-2 text-xs text-fg-secondary outline-none focus:border-gold-500"
            >
              <option value="">…or pick one from your Documents library</option>
              {library.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          ) : null}
          {loading ? <span className="font-mono text-[11px] text-fg-muted">{loading}</span> : null}
          {loadError ? <span className="text-xs text-status-danger">{loadError}</span> : null}
          <span className="font-mono text-[11px] text-fg-muted">
            PDF and Office uploads are saved privately to Documents so Earn can read them.
          </span>
          <textarea
            value={docText}
            onChange={(e) => setDocText(e.target.value)}
            rows={8}
            placeholder="Paste the deck / CIM / PPM / financials / call notes here…"
            className="rounded-md border border-line bg-surface-0 px-3 py-2 font-mono text-xs leading-relaxed text-fg-primary outline-none focus:border-gold-500"
          />
        </label>

        <label className="mt-4 flex flex-col gap-1.5 text-sm">
          <span className="text-fg-secondary">What should the Brain do?</span>
          <select
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
            className="rounded-md border border-line bg-surface-0 px-3 py-2 text-fg-primary outline-none focus:border-gold-500"
          >
            {DILIGENCE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={run}
          disabled={!canRun}
          className="mt-5 rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-on-gold transition hover:bg-gold-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Brain is working…" : "Ask Earn"}
        </button>
      </div>

      {result ? (
        result.ok ? (
          <div className="rounded-2xl border border-line bg-surface-1 p-5">
            <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
              <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-gold-300">
                {result.brainName}
              </span>
              {(result.toolsUsed ?? []).map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-fg-muted"
                >
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-fg-primary">
              {result.output}
            </p>
            {result.reasoning ? (
              <p className="mt-4 border-t border-line pt-3 font-mono text-[11px] leading-relaxed text-fg-muted">
                {result.reasoning}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="rounded-2xl border border-status-danger/40 bg-surface-1 p-5 text-sm text-status-danger">
            {result.error}
          </div>
        )
      ) : null}
    </div>
  );
}
