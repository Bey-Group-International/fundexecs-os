"use client";

// The composer's files: attach from the computer (button or drag-and-drop),
// attach a library document, or insert a data-room link into the message.
//
// Uploads go straight from the browser to Storage over a one-shot signed URL
// (requestAttachmentUpload), so a deck never passes through a server action.
// What the composer keeps is a reference; the server reads the file back from
// Storage when the reply is sent, attaches what fits under Gmail's limit, and
// sends the rest as expiring download links.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  INBOX_ATTACHMENT_BUCKET,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_FILE_BYTES,
  formatFileSize,
  type AttachmentRef,
} from "@/lib/inbox/attachments";
import { createInboxRoomLink, listInboxDocuments, requestAttachmentUpload } from "./attachment-actions";

export interface ComposerFile {
  key: string;
  name: string;
  size: number;
  status: "uploading" | "ready" | "error";
  ref?: AttachmentRef;
  error?: string;
}

/** The files ready to send, as the reply's `attachments` field. */
export function readyRefs(files: readonly ComposerFile[]): AttachmentRef[] {
  return files.filter((f) => f.status === "ready" && f.ref).map((f) => f.ref!);
}

let seq = 0;
const nextKey = () => `f${Date.now().toString(36)}${(seq++).toString(36)}`;

type Picker = null | "documents" | "room";

export function ComposerAttachments({
  threadId,
  files,
  onChange,
  onInsertText,
  canAttach,
  disabled,
  children,
}: {
  threadId: string;
  files: ComposerFile[];
  onChange: (update: (prev: ComposerFile[]) => ComposerFile[]) => void;
  /** Put a data-room link into the message. */
  onInsertText: (text: string) => void;
  /** Files go only by email; other channels still get data-room links. */
  canAttach: boolean;
  disabled?: boolean;
  /** The composer itself, which also accepts dropped files. */
  children: React.ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [docs, setDocs] = useState<Awaited<ReturnType<typeof listInboxDocuments>> | null>(null);
  const [query, setQuery] = useState("");
  const [linking, setLinking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File) => {
      const key = nextKey();
      onChange((prev) => [...prev, { key, name: file.name, size: file.size, status: "uploading" }]);
      const fail = (error: string) =>
        onChange((prev) => prev.map((f) => (f.key === key ? { ...f, status: "error", error } : f)));
      if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
        fail("Over 100 MB — share it as a data room link instead.");
        return;
      }
      try {
        const ticket = await requestAttachmentUpload({ name: file.name, size: file.size });
        if (!ticket.ok) return fail(ticket.error);
        const { error } = await createClient()
          .storage.from(INBOX_ATTACHMENT_BUCKET)
          .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type || "application/octet-stream" });
        if (error) return fail("Upload failed. Try again.");
        const ref: AttachmentRef = {
          kind: "upload",
          path: ticket.path,
          name: file.name,
          size: file.size,
          mimeType: file.type || "application/octet-stream",
        };
        onChange((prev) => prev.map((f) => (f.key === key ? { ...f, status: "ready", ref } : f)));
      } catch {
        fail("Upload failed. Try again.");
      }
    },
    [onChange],
  );

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      setNotice(null);
      const room = MAX_ATTACHMENTS - files.length;
      const chosen = Array.from(list);
      if (chosen.length > room) setNotice(`Up to ${MAX_ATTACHMENTS} files per message.`);
      for (const f of chosen.slice(0, Math.max(0, room))) void upload(f);
    },
    [files.length, upload],
  );

  useEffect(() => {
    if (!picker || docs) return;
    let alive = true;
    listInboxDocuments()
      .then((d) => alive && setDocs(d))
      .catch(() => alive && setDocs({ library: [], rooms: [] }));
    return () => {
      alive = false;
    };
  }, [picker, docs]);

  const q = query.trim().toLowerCase();
  const libraryShown = useMemo(
    () => (docs?.library ?? []).filter((d) => !q || d.name.toLowerCase().includes(q)).slice(0, 50),
    [docs, q],
  );
  const roomsShown = useMemo(
    () => (docs?.rooms ?? []).filter((d) => !q || d.name.toLowerCase().includes(q)).slice(0, 50),
    [docs, q],
  );

  const addDocument = (d: { id: string; name: string; size: number; mimeType: string }) => {
    if (files.length >= MAX_ATTACHMENTS) return setNotice(`Up to ${MAX_ATTACHMENTS} files per message.`);
    if (files.some((f) => f.ref?.kind === "document" && f.ref.documentId === d.id)) return;
    onChange((prev) => [
      ...prev,
      {
        key: nextKey(),
        name: d.name,
        size: d.size,
        status: "ready",
        ref: { kind: "document", documentId: d.id, name: d.name, size: d.size, mimeType: d.mimeType },
      },
    ]);
    setPicker(null);
  };

  const insertLink = async (d: { id: string; name: string }) => {
    setLinking(d.id);
    setNotice(null);
    try {
      const r = await createInboxRoomLink(threadId, d.id);
      if (r.ok) {
        onInsertText(`${r.name}: ${r.url}`);
        setPicker(null);
      } else setNotice(r.error);
    } catch {
      setNotice("Couldn't create the link. Try again.");
    } finally {
      setLinking(null);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        if (!canAttach || disabled || !e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!canAttach || disabled) return;
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
      }}
      className={`relative rounded-md ${dragging ? "ring-2 ring-gold-500/60" : ""}`}
    >
      {children}
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-surface-0/80 text-xs text-gold-300">
          Drop files to attach
        </div>
      ) : null}

      {files.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Attachments">
          {files.map((f) => (
            <li
              key={f.key}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] ${
                f.status === "error" ? "border-status-danger/50 text-status-danger" : "border-line text-fg-secondary"
              }`}
              title={f.error}
            >
              <span aria-hidden>📎</span>
              <span className="max-w-[12rem] truncate">{f.name}</span>
              <span className="text-fg-muted">
                {f.status === "uploading" ? "uploading…" : f.status === "error" ? (f.error ?? "failed") : formatFileSize(f.size)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => onChange((prev) => prev.filter((x) => x.key !== f.key))}
                className="text-fg-muted hover:text-status-danger"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        {canAttach ? (
          <>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              aria-label="Attach files"
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => input.current?.click()}
              className="rounded-md border border-line px-2 py-1 text-fg-secondary transition hover:border-gold-500 hover:text-fg-primary disabled:opacity-50"
            >
              📎 Attach
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setPicker(picker === "documents" ? null : "documents")}
              aria-expanded={picker === "documents"}
              className="rounded-md border border-line px-2 py-1 text-fg-secondary transition hover:border-gold-500 hover:text-fg-primary disabled:opacity-50"
            >
              From Documents
            </button>
          </>
        ) : null}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setPicker(picker === "room" ? null : "room")}
          aria-expanded={picker === "room"}
          className="rounded-md border border-line px-2 py-1 text-fg-secondary transition hover:border-gold-500 hover:text-fg-primary disabled:opacity-50"
        >
          Data room link
        </button>
      </div>

      {picker ? (
        <div className="mt-1.5 rounded-md border border-line bg-surface-1 p-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={picker === "room" ? "Search data room documents…" : "Search documents…"}
            aria-label="Search documents"
            className="mb-1.5 w-full rounded border border-line bg-surface-0/70 px-2 py-1 text-xs text-fg-primary outline-none focus:border-gold-500"
          />
          {!docs ? (
            <p className="text-xs text-fg-muted">Loading…</p>
          ) : picker === "documents" ? (
            libraryShown.length ? (
              <ul className="max-h-48 overflow-y-auto">
                {libraryShown.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => addDocument(d)}
                      className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
                    >
                      <span className="truncate">{d.name}</span>
                      <span className="shrink-0 text-fg-muted">{formatFileSize(d.size)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-fg-muted">No uploaded documents{q ? " match" : " yet"}.</p>
            )
          ) : roomsShown.length ? (
            <ul className="max-h-48 overflow-y-auto">
              {roomsShown.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    disabled={linking !== null}
                    onClick={() => void insertLink(d)}
                    className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs text-fg-secondary hover:bg-surface-2 hover:text-fg-primary disabled:opacity-50"
                  >
                    <span className="truncate">{d.name}</span>
                    <span className="shrink-0 text-fg-muted">{linking === d.id ? "Creating link…" : d.roomName}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-fg-muted">No published data room documents{q ? " match" : ""}.</p>
          )}
          {picker === "room" ? (
            <p className="mt-1.5 text-[11px] text-fg-muted">
              A tracked link: the reader enters their email, pages are watermarked, and it expires in 14 days.
            </p>
          ) : null}
        </div>
      ) : null}
      {notice ? <p className="mt-1 text-[11px] text-status-danger">{notice}</p> : null}
    </div>
  );
}
