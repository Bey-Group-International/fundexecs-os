"use client";

import { useState, useRef, useTransition } from "react";

type ImportMode = "auto" | "person" | "firm";

interface Props {
  onClose: () => void;
  onImported: (count: number) => void;
}

const ACCEPTED = ".csv";
const MODE_LABELS: Record<ImportMode, string> = {
  auto: "Auto-detect",
  person: "People list",
  firm: "Firm / Fund list",
};

function fileType(f: File): "csv" | null {
  const n = f.name.toLowerCase();
  if (n.endsWith(".csv")) return "csv";
  return null;
}

export function LinkedInImportModal({ onClose, onImported }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>("auto");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    if (!fileType(f)) {
      setError("Please upload a CSV file. Convert spreadsheets to CSV before importing.");
      return;
    }
    setError(null);
    setFile(f);
  }

  async function submit() {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/network/import?mode=${mode}`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Import failed"); return; }
      onImported(data.total ?? 0);
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-bg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <h2 className="font-semibold text-fg">Import Contacts</h2>
            <p className="text-xs text-fg-muted mt-0.5">LinkedIn export, family office list, or fund list CSV</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-surface text-fg-muted hover:text-fg transition-colors">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 flex flex-col gap-5">
          {/* Format guide */}
          <div className="rounded-lg border border-line bg-surface p-4 text-sm text-fg-muted space-y-2">
            <p className="font-medium text-fg text-xs uppercase tracking-wider font-mono">Supported formats</p>
            <ul className="space-y-1 text-xs list-disc ml-4">
              <li><strong className="text-fg">LinkedIn CSV</strong> — export from LinkedIn Settings → Data Privacy → Connections</li>
              <li><strong className="text-fg">People list CSV</strong> — first name, last name, email, title, company, LinkedIn URL</li>
              <li><strong className="text-fg">Fund / Firm list CSV</strong> — fund name, city, state, stage; no person columns required</li>
            </ul>
          </div>

          {/* Mode selector */}
          <div>
            <label className="text-xs text-fg-muted font-mono uppercase tracking-wider mb-1.5 block">Import mode</label>
            <div className="flex rounded-lg border border-line bg-surface p-1 gap-1">
              {(["auto", "person", "firm"] as ImportMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                    mode === m ? "bg-accent text-white" : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
            {mode === "auto" && (
              <p className="text-xs text-fg-muted mt-1">Detected from column headers — works for most files.</p>
            )}
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
            onClick={() => fileRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors ${
              isDragging ? "border-accent bg-accent/5" : "border-line hover:border-fg-muted/40 hover:bg-surface"
            }`}
          >
            <svg className="h-8 w-8 text-fg-muted" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path d="M9 12h6m-3-3v6M3 17V7a2 2 0 0 1 2-2h6l2 2h4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
            </svg>
            {file ? (
              <div className="text-center">
                <p className="text-sm font-medium text-fg">{file.name}</p>
                <p className="text-xs text-fg-muted">{(file.size / 1024).toFixed(0)} KB · CSV</p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm text-fg">Drop file here or <span className="text-accent underline">browse</span></p>
                <p className="text-xs text-fg-muted mt-1">CSV only</p>
              </div>
            )}
            <input ref={fileRef} type="file" accept={ACCEPTED} className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg border border-line py-2.5 text-sm text-fg-muted hover:text-fg hover:border-fg-muted/40 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!file || isPending}
              className="flex-1 rounded-lg bg-accent py-2.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-40 transition-colors"
            >
              {isPending ? "Importing…" : "Import Contacts"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
