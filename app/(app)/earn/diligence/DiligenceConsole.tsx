"use client";

import { useState, useTransition } from "react";
import { DILIGENCE_PRESETS } from "@/lib/brains/diligence";
import type { DiligenceResponse } from "@/lib/brains/types";
import { askDiligence } from "../actions";

// Upload/paste a document, pick a preset question, and run the routed Brain.
// Renders the deliverable plus an audit strip (Brain, tools used, reasoning).
export function DiligenceConsole() {
  const [docName, setDocName] = useState("");
  const [docText, setDocText] = useState("");
  const [presetId, setPresetId] = useState(DILIGENCE_PRESETS[0].id);
  const [result, setResult] = useState<DiligenceResponse | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(file: File | undefined) {
    if (!file) return;
    setDocName(file.name);
    setDocText(await file.text());
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
            <span className="font-mono text-[10px] text-fg-muted">
              or{" "}
              <label className="cursor-pointer text-gold-400 hover:underline">
                upload a .txt/.md
                <input
                  type="file"
                  accept=".txt,.md,.markdown,text/plain"
                  className="hidden"
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
              </label>
            </span>
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
          className="mt-5 rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Brain is working…" : "Ask Earn"}
        </button>
      </div>

      {result ? (
        result.ok ? (
          <div className="rounded-2xl border border-line bg-surface-1 p-5">
            <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
              <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gold-300">
                {result.brainName}
              </span>
              {(result.toolsUsed ?? []).map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-fg-muted"
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
