"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { inputClass } from "./DraftWithEarn";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import { scoreDocument } from "@/lib/document-quality";
import { deleteDocument, updateDocument, updateDocumentStatus } from "./materials-actions";
import type { DocumentStatus } from "@/lib/supabase/database.types";
import { autoComposeContent, earnChat, institutionalize } from "./builder-actions";
import { BuilderWizard } from "./BuilderWizard";
import { TemplatePicker } from "./TemplatePicker";
import { VersionHistory } from "./VersionHistory";
import { MarkdownRenderer } from "@/components/dataroom/MarkdownRenderer";
import type { DraftTurn } from "@/lib/claude";

type Tab = "guided" | "parse" | "earn";
type PaneMode = "split" | "edit" | "preview";
type SidePanel = "none" | "history";

const TEXT_TYPES = [".txt", ".md", ".markdown", ".csv", ".json", ".text"];

export interface BuilderDoc {
  id: string;
  name: string;
  doc_type: string | null;
  content: string | null;
  storage_key: string | null;
  status?: DocumentStatus;
}

export function DocumentBuilder({ doc }: { doc: BuilderDoc }) {
  const [tab, setTab] = useState<Tab>("guided");
  const [paneMode, setPaneMode] = useState<PaneMode>("split");
  const [sidePanel, setSidePanel] = useState<SidePanel>("none");
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [name, setName] = useState(doc.name);
  const [section, setSection] = useState(doc.doc_type ?? "other");
  const [content, setContent] = useState(doc.content ?? "");
  const [dirtySaved, setDirtySaved] = useState<"idle" | "saving" | "saved">("idle");
  const [docStatus, setDocStatus] = useState<DocumentStatus>(doc.status ?? "ready");
  const [statusPending, startStatusTransition] = useTransition();
  const [pending, startTransition] = useTransition();
  const isLink = !!doc.storage_key;

  const STATUS_CYCLE: DocumentStatus[] = ["draft", "review", "ready"];
  const STATUS_LABELS: Record<DocumentStatus, string> = { draft: "Draft", review: "Review", ready: "Ready ✓" };
  const STATUS_CLASSES: Record<DocumentStatus, string> = {
    draft: "border-line text-fg-muted",
    review: "border-amber-500/40 text-amber-400",
    ready: "border-emerald-500/40 text-emerald-400 bg-emerald-500/5",
  };

  function cycleStatus() {
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(docStatus) + 1) % STATUS_CYCLE.length];
    setDocStatus(next);
    startStatusTransition(async () => {
      const fd = new FormData();
      fd.set("id", doc.id);
      fd.set("status", next);
      await updateDocumentStatus(fd);
    });
  }

  const [messages, setMessages] = useState<DraftTurn[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function save() {
    setDirtySaved("saving");
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", doc.id);
      fd.set("name", name.trim() || doc.name);
      fd.set("section", section);
      fd.set("content", content);
      if (isLink) fd.set("url", doc.storage_key ?? "");
      await updateDocument(fd);
      setDirtySaved("saved");
      setTimeout(() => setDirtySaved("idle"), 1500);
    });
  }

  async function compose() {
    setBusy(true);
    setNote(null);
    const res = await autoComposeContent(doc.id);
    setBusy(false);
    if ("error" in res) setNote(res.error);
    else {
      setContent(res.content);
      setTab("guided");
      setNote("Composed a draft from your firm data — review and save.");
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
    const looksText = file.type.startsWith("text/") || TEXT_TYPES.includes(ext);
    if (!looksText) {
      setNote("Only text files (.txt, .md, .csv, .json) can be extracted in-browser. For PDF/DOCX, paste the text.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const text = await file.text();
    setContent(text);
    setTab("guided");
    setNote(`Imported ${file.name} — review and save.`);
    if (fileRef.current) fileRef.current.value = "";
  }

  const report = useMemo(() => scoreDocument(name, section, content), [name, section, content]);

  async function institutionalizeDraft() {
    if (!content.trim() || busy) return;
    setBusy(true);
    setNote(null);
    const res = await institutionalize(doc.id, content);
    setBusy(false);
    if ("error" in res) setNote(res.error);
    else setContent(res.content);
  }

  async function sendEarn() {
    const msg = chatInput.trim();
    if (!msg || busy) return;
    const next: DraftTurn[] = [...messages, { role: "user", content: msg }];
    setMessages(next);
    setChatInput("");
    setBusy(true);
    const res = await earnChat(doc.id, next, content);
    setBusy(false);
    if ("error" in res) {
      setMessages([...next, { role: "assistant", content: res.error }]);
      return;
    }
    setMessages([...next, { role: "assistant", content: res.reply }]);
    setContent(res.content);
  }

  function handleTemplateSelect(templateContent: string, templateName: string) {
    setShowTemplatePicker(false);
    if (templateContent) {
      setContent(templateContent);
      if (templateName && !name.trim()) setName(templateName);
      setNote("Template applied — fill in the [placeholders] and save.");
    }
  }

  const tabBtn = (t: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      className={`rounded-md px-3 py-1.5 text-sm transition ${
        tab === t ? "bg-gold-400 text-surface-0" : "border border-line text-fg-secondary hover:text-fg-primary"
      }`}
    >
      {label}
    </button>
  );

  const paneModeBtn = (mode: PaneMode, label: string) => (
    <button
      type="button"
      onClick={() => setPaneMode(mode)}
      className={`px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider transition ${
        paneMode === mode ? "text-gold-400" : "text-fg-muted hover:text-fg-secondary"
      }`}
    >
      {label}
    </button>
  );

  const showEdit = paneMode === "edit" || paneMode === "split";
  const showPreview = paneMode === "preview" || paneMode === "split";

  return (
    <>
      {showTemplatePicker && (
        <TemplatePicker
          section={section}
          onSelect={handleTemplateSelect}
          onClose={() => setShowTemplatePicker(false)}
        />
      )}

      <div className={`grid gap-5 ${sidePanel !== "none" ? "lg:grid-cols-[1fr_300px]" : ""}`}>
        <div className="flex flex-col gap-5">
          {/* Identity row */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-fg-secondary">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-fg-secondary">Section</span>
              <select value={section} onChange={(e) => setSection(e.target.value)} className={inputClass}>
                {DATA_ROOM_SECTIONS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {isLink ? (
            <p className="-mt-2 text-xs text-fg-muted">
              Linked file:{" "}
              <a href={doc.storage_key ?? "#"} target="_blank" rel="noopener noreferrer" className="text-gold-400 hover:underline">
                open original →
              </a>{" "}
              · the draft below is saved with the document.
            </p>
          ) : null}

          {/* Two-column: mode controls left, editor right */}
          <div className="grid gap-5 lg:grid-cols-2">
            {/* Left: mode controls */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-1.5">
                {tabBtn("guided", "Guided setup")}
                {tabBtn("parse", "Parse")}
                {tabBtn("earn", "✶ Earn")}
                <button
                  type="button"
                  onClick={() => setShowTemplatePicker(true)}
                  className="rounded-md border border-gold-500/40 bg-gold-500/5 px-3 py-1.5 text-sm text-gold-300 transition hover:bg-gold-500/15"
                >
                  Templates
                </button>
              </div>

              {note ? (
                <p className="rounded-lg border border-gold-500/30 bg-gold-500/5 px-3 py-2 text-xs text-fg-secondary">{note}</p>
              ) : null}

              {tab === "guided" ? (
                <BuilderWizard docId={doc.id} name={name} section={section} onContent={setContent} />
              ) : null}

              {tab === "parse" ? (
                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={compose}
                    disabled={busy}
                    className="rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-60"
                  >
                    {busy ? "Composing…" : "✶ Compose from my data"}
                  </button>
                  <p className="text-xs text-fg-muted">
                    Builds a first draft from your Profile, Thesis, Track Record, and Team.
                  </p>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-fg-secondary">Import a text file</span>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".txt,.md,.markdown,.csv,.json,text/*"
                      onChange={onFile}
                      className="text-xs text-fg-secondary file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-fg-primary"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-fg-secondary">…or paste content</span>
                    <textarea
                      rows={6}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder="Paste text or markdown to import…"
                      className={`${inputClass} resize-y`}
                    />
                  </label>
                </div>
              ) : null}

              {tab === "earn" ? (
                <div className="flex flex-col gap-3">
                  <div className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-lg border border-line bg-surface-1 p-3">
                    {messages.length === 0 ? (
                      <p className="text-xs text-fg-muted">
                        Ask Earn to draft or revise this document — e.g. "Draft an executive summary highlighting our track record."
                      </p>
                    ) : (
                      messages.map((m, i) => (
                        <div
                          key={i}
                          className={`max-w-[85%] rounded-lg px-3 py-1.5 text-sm ${
                            m.role === "user"
                              ? "self-end bg-gold-500/15 text-fg-primary"
                              : "self-start border border-line bg-surface-0 text-fg-secondary"
                          }`}
                        >
                          {m.content}
                        </div>
                      ))
                    )}
                    {busy ? <span className="self-start text-xs text-fg-muted">Earn is drafting…</span> : null}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void sendEarn();
                        }
                      }}
                      placeholder="Message Earn…"
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => void sendEarn()}
                      disabled={busy}
                      className="rounded-md bg-gold-400 px-4 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-60"
                    >
                      Send
                    </button>
                  </div>
                  <p className="text-xs text-fg-muted">Earn updates the draft on the right. Review and Save.</p>
                </div>
              ) : null}
            </div>

            {/* Right: draft editor */}
            <div className="flex flex-col gap-3">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Pane mode toggle */}
                <div className="flex items-center gap-0.5 rounded-md border border-line bg-surface-1 px-1 py-0.5">
                  {paneModeBtn("edit", "Edit")}
                  <span className="text-[10px] text-fg-muted/30">|</span>
                  {paneModeBtn("split", "Split")}
                  <span className="text-[10px] text-fg-muted/30">|</span>
                  {paneModeBtn("preview", "Preview")}
                </div>

                <button
                  type="button"
                  onClick={cycleStatus}
                  disabled={statusPending}
                  title="Click to advance publish status: Draft → Review → Ready"
                  className={`rounded-full border px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-wider transition hover:opacity-80 disabled:opacity-50 ${STATUS_CLASSES[docStatus]}`}
                >
                  {STATUS_LABELS[docStatus]}
                </button>

                {dirtySaved === "saved" ? (
                  <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-400">Saved ✓</span>
                ) : null}

                <button
                  type="button"
                  onClick={() => setSidePanel((p) => (p === "history" ? "none" : "history"))}
                  className={`rounded-md border px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider transition ${
                    sidePanel === "history"
                      ? "border-gold-500/40 bg-gold-500/10 text-gold-300"
                      : "border-line text-fg-muted hover:text-fg-secondary"
                  }`}
                >
                  History
                </button>

                <button
                  type="button"
                  onClick={() => void institutionalizeDraft()}
                  disabled={busy || !content.trim()}
                  className="rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-sm font-medium text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
                >
                  {busy ? "Working…" : "✶ Institutionalize"}
                </button>

                <button
                  type="button"
                  onClick={save}
                  disabled={pending}
                  className="rounded-md bg-gold-400 px-4 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-60"
                >
                  {dirtySaved === "saving" ? "Saving…" : "Save"}
                </button>

                <form
                  action={deleteDocument}
                  onSubmit={(event) => {
                    if (!confirm(`Delete "${doc.name}" permanently?`)) event.preventDefault();
                  }}
                >
                  <input type="hidden" name="id" value={doc.id} />
                  <button className="rounded-md border border-status-danger/40 px-3 py-1.5 text-sm text-status-danger transition hover:bg-status-danger/10">
                    Delete
                  </button>
                </form>
              </div>

              {/* Institutional readiness */}
              <div className="rounded-lg border border-line bg-surface-1 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Institutional readiness</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                      report.level === "Institutional"
                        ? "border-emerald-400/40 text-emerald-300"
                        : report.level === "Solid"
                          ? "border-gold-500/40 text-gold-300"
                          : "border-line text-fg-muted"
                    }`}
                  >
                    {report.level}
                  </span>
                  <span className="ml-auto font-display text-lg font-semibold text-fg-primary">{report.score}%</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full bg-gold-400" style={{ width: `${report.score}%` }} />
                </div>
                {report.gaps.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-0.5">
                    {report.gaps.map((g, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-fg-secondary">
                        <span className="text-fg-muted">○</span>
                        {g}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-emerald-300">✓ Meets the institutional bar for this section.</p>
                )}
              </div>

              {/* Split / edit / preview */}
              <div className={`grid gap-3 ${paneMode === "split" ? "grid-cols-2" : "grid-cols-1"}`}>
                {showEdit && (
                  <div className="flex flex-col gap-1">
                    {paneMode === "split" && (
                      <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">Markdown</span>
                    )}
                    <textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      rows={22}
                      placeholder="Your document content…"
                      className={`${inputClass} resize-y font-mono text-[13px] leading-relaxed`}
                    />
                  </div>
                )}
                {showPreview && (
                  <div className="flex flex-col gap-1">
                    {paneMode === "split" && (
                      <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">Preview</span>
                    )}
                    <div className="min-h-[22rem] overflow-y-auto rounded-lg border border-line bg-surface-1 px-4 py-3">
                      {content.trim() ? (
                        <MarkdownRenderer content={content} />
                      ) : (
                        <p className="text-xs text-fg-muted">Nothing to preview yet — start writing or generate a draft.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Side panel: version history */}
        {sidePanel === "history" && (
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-0 p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">Version History</span>
              <button type="button" onClick={() => setSidePanel("none")} className="text-fg-muted hover:text-fg-primary">
                ✕
              </button>
            </div>
            <VersionHistory
              docId={doc.id}
              onRestore={(restoredContent) => {
                setContent(restoredContent);
                setNote("Version restored — review the draft and save to confirm.");
              }}
            />
          </div>
        )}
      </div>
    </>
  );
}
