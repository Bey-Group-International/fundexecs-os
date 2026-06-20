"use client";

import { useRef, useState, useTransition } from "react";
import { inputClass } from "./DraftWithEarn";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import { updateDocument } from "./materials-actions";
import { autoComposeContent, earnChat } from "./builder-actions";
import { BuilderWizard } from "./BuilderWizard";
import type { DraftTurn } from "@/lib/claude";

type Tab = "guided" | "parse" | "earn";

const TEXT_TYPES = [".txt", ".md", ".markdown", ".csv", ".json", ".text"];

export interface BuilderDoc {
  id: string;
  name: string;
  doc_type: string | null;
  content: string | null;
  storage_key: string | null;
}

export function DocumentBuilder({ doc }: { doc: BuilderDoc }) {
  const [tab, setTab] = useState<Tab>("guided");
  const [name, setName] = useState(doc.name);
  const [section, setSection] = useState(doc.doc_type ?? "other");
  const [content, setContent] = useState(doc.content ?? "");
  const [dirtySaved, setDirtySaved] = useState<"idle" | "saving" | "saved">("idle");
  const [pending, startTransition] = useTransition();
  const isLink = !!doc.storage_key;

  // Earn chat
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

  const tabBtn = (t: Tab, label: string) =>
    (
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

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Left: mode controls */}
      <div className="flex flex-col gap-4">
        {/* Shared identity — name + section apply across every mode */}
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
          <p className="-mt-1 text-xs text-fg-muted">
            Linked file:{" "}
            <a href={doc.storage_key ?? "#"} target="_blank" rel="noopener noreferrer" className="text-gold-400 hover:underline">
              open original →
            </a>{" "}
            · the draft below is saved with the document.
          </p>
        ) : null}

        <div className="flex gap-1.5">
          {tabBtn("guided", "Guided setup")}
          {tabBtn("parse", "Parse")}
          {tabBtn("earn", "✶ Earn")}
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
                  Ask Earn to draft or revise this document — e.g. “Draft an executive summary highlighting our track record.”
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

      {/* Right: the document draft */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">Draft</span>
          <div className="flex items-center gap-2">
            {dirtySaved === "saved" ? (
              <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-400">Saved ✓</span>
            ) : null}
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-md bg-gold-400 px-4 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-60"
            >
              {dirtySaved === "saving" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={22}
          placeholder="Your document content…"
          className={`${inputClass} resize-y font-mono text-[13px] leading-relaxed`}
        />
      </div>
    </div>
  );
}
