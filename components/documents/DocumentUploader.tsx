"use client";

// Drag-and-drop, multi-file upload for the library.
//
// The file never passes through the app: `createUploadTicket` returns a signed
// path, the browser PUTs straight to Storage, and `finalizeUpload` re-reads the
// object server-side and writes the real size and type onto the row. That is
// what makes a 60 MB PPM work at all — a Server Action body is capped around a
// megabyte.
//
// Uploads run one at a time. A fund operator dropping twelve files is usually
// on the same connection as everything else they are doing; six parallel PUTs
// would finish no sooner and would make each individual failure harder to read.
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ACCEPTED_DOCUMENT_ATTR,
  DOCUMENT_BUCKET,
  MAX_UPLOAD_BYTES,
  checkUploadCandidate,
  formatBytes,
} from "@/lib/document-files";
import { abandonUpload, createUploadTicket, finalizeUpload } from "./upload-actions";

type Supabase = ReturnType<typeof createClient>;

/**
 * Put one file in the bucket and attach it to a document.
 *
 * Exported because replacing a document's file is the same three steps with a
 * `documentId` — the only difference is that the server versions what was there
 * instead of creating a row.
 */
export async function uploadDocumentFile(
  supabase: Supabase,
  input: { file: File; section: string; documentId?: string },
): Promise<{ ok: true; documentId: string } | { ok: false; error: string }> {
  const { file, section, documentId } = input;

  // Check before minting anything, so an unsupported file costs no round trip
  // and the operator hears the same sentence the server would have said.
  const local = checkUploadCandidate({ name: file.name, size: file.size, type: file.type });
  if (!local.ok) return { ok: false, error: local.reason };

  const ticket = await createUploadTicket({
    section,
    fileName: file.name,
    size: file.size,
    mimeType: file.type,
    documentId,
  });
  if (!ticket.ok) return { ok: false, error: ticket.error };

  try {
    const { error } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .uploadToSignedUrl(ticket.path, ticket.token, file, {
        contentType: file.type || undefined,
      });
    if (error) throw error;
  } catch {
    // Leave nothing half-made: the object if any of it landed, and the shell
    // row if this upload is the only reason it exists.
    await abandonUpload({ documentId: ticket.documentId, path: ticket.path });
    return { ok: false, error: "That upload didn't finish. Check your connection and try again." };
  }

  const done = await finalizeUpload({ documentId: ticket.documentId, path: ticket.path });
  if (!done.ok) {
    await abandonUpload({ documentId: ticket.documentId, path: ticket.path });
    return { ok: false, error: done.error };
  }
  return { ok: true, documentId: ticket.documentId };
}

interface QueueItem {
  key: string;
  name: string;
  size: number;
  state: "waiting" | "uploading" | "done" | "failed";
  error?: string;
}

export function DocumentUploader({
  section,
  sectionLabel,
}: {
  /** Section (doc_type) uploaded files are filed under. */
  section: string;
  sectionLabel: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const busy = useRef(false);

  const run = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const items: QueueItem[] = files.map((f, i) => ({
        key: `${Date.now()}-${i}-${f.name}`,
        name: f.name,
        size: f.size,
        state: "waiting",
      }));
      // Keep finished rows on screen: after a twelve-file drop the operator
      // needs to see which two failed, not an empty box.
      setQueue((prev) => [...prev.filter((q) => q.state === "failed"), ...items]);

      busy.current = true;
      let landed = false;
      for (let i = 0; i < files.length; i += 1) {
        const key = items[i].key;
        setQueue((prev) => prev.map((q) => (q.key === key ? { ...q, state: "uploading" } : q)));
        const result = await uploadDocumentFile(supabase, { file: files[i], section });
        landed ||= result.ok;
        setQueue((prev) =>
          prev.map((q) =>
            q.key === key
              ? result.ok
                ? { ...q, state: "done" }
                : { ...q, state: "failed", error: result.error }
              : q,
          ),
        );
      }
      busy.current = false;
      if (landed) router.refresh();
    },
    [router, section, supabase],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      void run(Array.from(e.dataTransfer.files));
    },
    [run],
  );

  const active = queue.filter((q) => q.state === "uploading" || q.state === "waiting").length;
  const failed = queue.filter((q) => q.state === "failed");

  return (
    <div>
      {/* The drop zone is a label, so a click and a keyboard Enter both open the
          picker without a second interactive element inside the target. */}
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-6 text-center transition ${
          dragging
            ? "border-gold-500/60 bg-gold-500/10"
            : "border-line bg-surface-0 hover:border-gold-500/40"
        }`}
      >
        <span className="font-mono text-[11px] uppercase tracking-wider text-gold-300">
          {active > 0 ? `Uploading ${active} file${active > 1 ? "s" : ""}…` : "Drop files to upload"}
        </span>
        <span className="text-xs text-fg-muted">
          Filed under {sectionLabel} · PDF, Office, text, or image · up to{" "}
          {formatBytes(MAX_UPLOAD_BYTES)} each
        </span>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_DOCUMENT_ATTR}
          className="sr-only"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void run(files);
          }}
        />
      </label>

      {queue.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1" aria-live="polite">
          {queue.map((q) => (
            <li
              key={q.key}
              className="flex items-center gap-2 rounded-lg border border-line/60 bg-surface-0 px-3 py-1.5 text-xs"
            >
              <span
                className={`shrink-0 font-mono text-[11px] uppercase tracking-wider ${
                  q.state === "done"
                    ? "text-emerald-400"
                    : q.state === "failed"
                      ? "text-red-400"
                      : "text-fg-muted"
                }`}
              >
                {q.state === "done"
                  ? "Added"
                  : q.state === "failed"
                    ? "Failed"
                    : q.state === "uploading"
                      ? "Uploading"
                      : "Queued"}
              </span>
              <span className="min-w-0 flex-1 truncate text-fg-secondary">{q.name}</span>
              <span className="shrink-0 font-mono text-[11px] text-fg-muted">
                {formatBytes(q.size)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {failed.length > 0 ? (
        <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
          {failed.map((q) => (
            <p key={q.key} className="text-xs text-red-300">
              <span className="text-fg-secondary">{q.name}</span> — {q.error}
            </p>
          ))}
          <button
            type="button"
            onClick={() => setQueue((prev) => prev.filter((q) => q.state !== "failed"))}
            className="mt-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted hover:text-fg-secondary"
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Replace the file on an existing document. The old file becomes a version. */
export function ReplaceFileButton({
  documentId,
  section,
  hasFile,
}: {
  documentId: string;
  section: string;
  hasFile: boolean;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const inputId = useId();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [error, setError] = useState("");

  return (
    <>
      <label
        htmlFor={inputId}
        title={
          state === "error"
            ? error
            : hasFile
              ? "Upload a new file — the current one is kept as a version"
              : "Attach a file to this document"
        }
        className={`shrink-0 cursor-pointer rounded-lg border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider transition ${
          state === "error"
            ? "border-red-500/40 text-red-400"
            : "border-line text-fg-muted hover:border-gold-500/40 hover:text-gold-300"
        }`}
      >
        {state === "busy" ? "…" : state === "error" ? "Retry" : hasFile ? "Replace" : "Attach"}
      </label>
      <input
        id={inputId}
        type="file"
        accept={ACCEPTED_DOCUMENT_ATTR}
        className="sr-only"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setState("busy");
          const result = await uploadDocumentFile(supabase, { file, section, documentId });
          if (result.ok) {
            setState("idle");
            router.refresh();
          } else {
            setError(result.error);
            setState("error");
          }
        }}
      />
    </>
  );
}
