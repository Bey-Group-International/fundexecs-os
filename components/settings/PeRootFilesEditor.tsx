"use client";

import { useMemo, useState } from "react";
import { approvePeMandate, clearPeRootFile, savePeRootFile } from "@/app/(app)/settings/pe-actions";
import { validateRootFileText } from "@/lib/pe/root-file-edit";

export interface StoredFile {
  key: string;
  content: string;
  version: number;
  updatedAt: string | null;
}

interface FileMeta {
  key: string;
  title: string;
  blurb: string;
  typed: boolean;
  starter: string;
}

// One card per root file. The textarea holds JSON; validation runs in the browser
// with the SAME pure module the server uses, so what you see is what will be
// stored (the parsed value, with anything dropped reported). Saving and approving
// are server actions gated to owners/admins.
export function PeRootFilesEditor({ files, stored, canManage }: { files: FileMeta[]; stored: StoredFile[]; canManage: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {!canManage && (
        <p className="rounded-xl border border-dashed border-line bg-surface-1 p-3 text-xs text-fg-muted">
          You can read these settings. Only organization owners and admins can change them.
        </p>
      )}
      {files.map((f) => (
        <FileCard key={f.key} meta={f} stored={stored.find((s) => s.key === f.key) ?? null} canManage={canManage} />
      ))}
    </div>
  );
}

function FileCard({ meta, stored, canManage }: { meta: FileMeta; stored: StoredFile | null; canManage: boolean }) {
  const [text, setText] = useState(stored?.content ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; lines: string[] } | null>(null);

  const live = useMemo(() => (text.trim() ? validateRootFileText(meta.key, text) : null), [meta.key, text]);
  const approved = meta.key === "mandate" && stored ? /"status":\s*"approved"/.test(stored.content) : false;

  const run = async (fn: () => Promise<{ ok: boolean; error?: string; warnings?: string[]; issues?: string[] }>, okText: string) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await fn();
      const lines = [...(r.error ? [r.error] : r.ok ? [okText] : []), ...(r.warnings ?? []), ...(r.issues ?? [])];
      setMessage({ tone: r.ok ? "ok" : "error", lines });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-surface-1 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-fg-primary">{meta.title}</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted">
          {stored ? `saved · v${stored.version}${approved ? " · approved" : meta.key === "mandate" ? " · draft" : ""}` : "not set · standing default"}
          {!meta.typed ? " · not read by a skill yet" : ""}
        </span>
      </div>
      <p className="mt-1 text-xs leading-snug text-fg-secondary">{meta.blurb}</p>

      <textarea
        aria-label={`${meta.title} (JSON)`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={meta.starter}
        spellCheck={false}
        rows={text ? Math.min(18, text.split("\n").length + 1) : 8}
        disabled={!canManage}
        className="mt-3 w-full rounded-lg border border-line bg-surface-0 p-3 font-mono text-xs text-fg-primary outline-none focus:border-gold-400 disabled:opacity-60"
      />

      {live && (
        <ul className="mt-2 space-y-1 text-xs">
          {live.errors.map((e) => (
            <li key={e} className="text-red-400">{e}</li>
          ))}
          {live.warnings.map((w) => (
            <li key={w} className="text-gold-300">{w}</li>
          ))}
          {live.mandateIssues?.map((i) => (
            <li key={i.message} className={i.severity === "blocker" ? "text-red-400" : "text-fg-muted"}>
              {i.severity === "blocker" ? "Blocks approval: " : "Note: "}
              {i.message}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !live?.ok}
            onClick={() => run(() => savePeRootFile(meta.key, text), "Saved.")}
            className="rounded-lg bg-gold-400 px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40"
          >
            Save
          </button>
          {!text.trim() && (
            <button type="button" onClick={() => setText(meta.starter)} className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-secondary hover:text-fg-primary">
              Insert starter
            </button>
          )}
          {meta.key === "mandate" && stored && (
            <button
              type="button"
              disabled={busy || approved}
              onClick={() => run(() => approvePeMandate(), "Mandate approved.")}
              className="rounded-lg border border-gold-400 px-3 py-1.5 text-xs font-semibold text-gold-300 disabled:opacity-40"
              title="Records you as the approver. Editing the mandate afterwards returns it to draft."
            >
              {approved ? "Approved" : "Approve mandate"}
            </button>
          )}
          {stored && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(async () => { const r = await clearPeRootFile(meta.key); if (r.ok) setText(""); return r; }, "Cleared — skills use the standing default.")}
              className="ml-auto rounded-lg border border-line px-3 py-1.5 text-xs text-fg-muted hover:text-red-400"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {message && (
        <ul className={`mt-2 space-y-1 text-xs ${message.tone === "ok" ? "text-fg-secondary" : "text-red-400"}`} role="status">
          {message.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
