"use client";

import { useRef, useState } from "react";
import {
  ACCEPTED_UPLOAD_ATTR,
  parseCSV,
  readFileHead,
  validateFileType,
} from "@/lib/file-validation";
import { xlsxToRows } from "@/lib/xlsx";

export interface CsvImportRow {
  [column: string]: string;
}

interface CsvImportProps {
  /** Column names expected by the target table — used for mapping UI. */
  expectedColumns: string[];
  /** Called with the final mapped rows when the user confirms the import. */
  onImport: (rows: CsvImportRow[]) => Promise<void> | void;
  /** Max rows allowed per import (default 500). */
  maxRows?: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

type Stage = "idle" | "mapping" | "preview" | "importing" | "done" | "error";

export function CsvImport({ expectedColumns, onImport, maxRows = 500 }: CsvImportProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  // mapping[expectedColumn] = csvHeader | "" (unmapped)
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function handleFile(file: File) {
    const head = await readFileHead(file);
    const check = validateFileType(
      { name: file.name, mime: file.type, head },
      { accept: ["csv", "xlsx"] },
    );
    if (!check.ok) {
      setErrorMsg(check.error);
      setStage("error");
      return;
    }

    let parsed: string[][];
    try {
      if (check.kind === "xlsx") {
        const bytes = new Uint8Array(await file.arrayBuffer());
        parsed = (await xlsxToRows(bytes)).filter((r) => r.some((c) => c.trim() !== ""));
      } else {
        const text = await file.text();
        parsed = parseCSV(text);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Couldn't read that file.");
      setStage("error");
      return;
    }

    if (parsed.length < 2) {
      setErrorMsg("The file must have a header row and at least one data row.");
      setStage("error");
      return;
    }
    const csvHeaders = parsed[0].map((h) => h.trim());
    const dataRows = parsed.slice(1, maxRows + 1);
    setHeaders(csvHeaders);
    setRawRows(dataRows);
    // Auto-map columns whose names match exactly (case-insensitive).
    const auto: Record<string, string> = {};
    for (const col of expectedColumns) {
      const match = csvHeaders.find((h) => h.toLowerCase() === col.toLowerCase());
      auto[col] = match ?? "";
    }
    setMapping(auto);
    setStage("mapping");
  }

  function buildMappedRows(): CsvImportRow[] {
    return rawRows.map((row) => {
      const out: CsvImportRow = {};
      for (const col of expectedColumns) {
        const csvCol = mapping[col];
        if (!csvCol) continue;
        const idx = headers.indexOf(csvCol);
        out[col] = idx >= 0 ? (row[idx] ?? "").trim() : "";
      }
      return out;
    });
  }

  async function handleImport() {
    setImporting(true);
    setStage("importing");
    try {
      await onImport(buildMappedRows());
      setStage("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Import failed.");
      setStage("error");
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setStage("idle");
    setErrorMsg(null);
    setHeaders([]);
    setRawRows([]);
    setMapping({});
    if (fileRef.current) fileRef.current.value = "";
  }

  // ── Idle / drop zone ───────────────────────────────────────────────────────
  if (stage === "idle" || stage === "error") {
    return (
      <div className="flex flex-col gap-3">
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter") fileRef.current?.click(); }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) { setStage("idle"); handleFile(file); }
          }}
          className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-line py-10 px-6 text-center transition hover:border-gold-500/40 hover:bg-surface-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
        >
          <span className="text-2xl">📄</span>
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-fg-primary">Drop a CSV or XLSX file here</p>
            <p className="text-xs text-fg-muted">or click to browse — up to {maxRows} rows</p>
          </div>
          <span className="rounded border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-secondary">
            Choose file
          </span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_UPLOAD_ATTR}
          className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {errorMsg ? (
          <p className="text-xs text-status-danger" role="alert">{errorMsg}</p>
        ) : (
          <p className="text-[11px] text-fg-muted">Accepted formats: CSV (.csv) and Excel (.xlsx).</p>
        )}
      </div>
    );
  }

  // ── Column mapping ─────────────────────────────────────────────────────────
  if (stage === "mapping") {
    const mappedCount = Object.values(mapping).filter(Boolean).length;
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-fg-primary">Map columns</p>
            <p className="text-xs text-fg-muted">
              {rawRows.length} rows detected · {mappedCount}/{expectedColumns.length} columns mapped
            </p>
          </div>
          <button type="button" onClick={reset} className="text-xs text-fg-muted hover:text-fg-primary transition">
            ← Choose different file
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {expectedColumns.map((col) => (
            <div key={col} className="grid grid-cols-2 items-center gap-3">
              <span className="text-xs font-medium text-fg-primary">{col}</span>
              <select
                value={mapping[col] ?? ""}
                onChange={(e) => setMapping((m) => ({ ...m, [col]: e.target.value }))}
                className="rounded-lg border border-line bg-surface-1 px-2 py-1.5 text-xs text-fg-primary outline-none focus:border-gold-400"
              >
                <option value="">— skip —</option>
                {headers.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setStage("preview")}
          disabled={mappedCount === 0}
          className="self-end rounded-lg bg-gold-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-gold-400 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
        >
          Preview →
        </button>
      </div>
    );
  }

  // ── Preview ────────────────────────────────────────────────────────────────
  if (stage === "preview") {
    const preview = buildMappedRows().slice(0, 5);
    const activeCols = expectedColumns.filter((c) => mapping[c]);
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-fg-primary">Preview</p>
            <p className="text-xs text-fg-muted">
              First 5 of {rawRows.length} rows · {activeCols.length} columns
            </p>
          </div>
          <button type="button" onClick={() => setStage("mapping")} className="text-xs text-fg-muted hover:text-fg-primary transition">
            ← Adjust mapping
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line bg-surface-1">
                {activeCols.map((col) => (
                  <th key={col} className="px-3 py-2 text-left font-mono uppercase tracking-wider text-fg-muted">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} className="border-b border-line/50 last:border-0 hover:bg-surface-1">
                  {activeCols.map((col) => (
                    <td key={col} className="px-3 py-2 text-fg-secondary">
                      {row[col] || <span className="text-fg-muted italic">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between">
          <button type="button" onClick={reset} className="text-xs text-fg-muted hover:text-fg-primary transition">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={importing}
            className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-gold-400 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
          >
            Import {rawRows.length} rows →
          </button>
        </div>
      </div>
    );
  }

  // ── Importing / Done ───────────────────────────────────────────────────────
  if (stage === "importing") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-1 px-4 py-6">
        <span className="animate-pulse text-gold-400">◇</span>
        <p className="text-sm text-fg-primary">Importing {rawRows.length} rows…</p>
      </div>
    );
  }

  if (stage === "done") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-status-success/30 bg-status-success/5 px-4 py-5 text-center">
        <p className="text-sm font-medium text-status-success">✓ {rawRows.length} rows imported successfully</p>
        <button type="button" onClick={reset} className="self-center text-xs text-fg-muted hover:text-fg-primary transition">
          Import another file
        </button>
      </div>
    );
  }

  return null;
}
