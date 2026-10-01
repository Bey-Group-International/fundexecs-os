"use client";

// Drag-and-drop, multi-file upload for the library.
//
// The file never passes through the app: `createUploadTicket` names the path,
// the browser sends the bytes straight to Storage over resumable (TUS) upload,
// and `finalizeUpload` re-reads the object server-side and writes the real size
// and type onto the row. That is what makes a 400 MB PPM or a recorded
// walkthrough work at all — a Server Action body is capped around a megabyte.
//
// Resumable matters at these sizes: the file goes up in 6 MB chunks, a dropped
// connection retries the chunk rather than the file, and the operator watches a
// real percentage instead of a word. The upload runs under the operator's own
// session, so Storage's writer-only RLS governs the write itself.
//
// Up to three files upload at once. Each row carries its own bar and its own
// error, so parallel transfers stay legible, and a twelve-file drop no longer
// waits on the slowest file at the front of the line.
import { useCallback, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Upload as TusUpload } from "tus-js-client";
import { createClient } from "@/lib/supabase/client";
import {
  ACCEPTED_DOCUMENT_ATTR,
  DOCUMENT_BUCKET,
  MAX_UPLOAD_BYTES,
  checkUploadCandidate,
  formatBytes,
  type UploadAllowance,
} from "@/lib/document-files";
import { ZIP_EXTENSION, isZipFile } from "@/lib/document-zip";
import { abandonUpload, createUploadTicket, finalizeUpload } from "./upload-actions";
import { ZipImport } from "./ZipImport";

type Supabase = ReturnType<typeof createClient>;

/** Supabase requires exactly 6 MB chunks for resumable uploads. */
const CHUNK_BYTES = 6 * 1024 * 1024;
const PARALLEL_UPLOADS = 3;

/** Turn a Storage/TUS failure into a sentence an operator can act on. */
export function uploadErrorMessage(err: unknown): string {
  const status =
    (err as { originalResponse?: { getStatus?: () => number } })?.originalResponse?.getStatus?.() ?? 0;
  const text = err instanceof Error ? err.message : String(err ?? "");
  if (status === 413 || /payload too large|maximum allowed size|exceeded the maximum/i.test(text)) {
    return `That file is larger than storage will accept. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`;
  }
  if (status === 401 || status === 403 || /row-level security|unauthori[sz]ed/i.test(text)) {
    return "You don't have permission to upload here. Ask an owner or admin.";
  }
  if (status === 409 || /already exists/i.test(text)) {
    return "A file is already stored at that location. Try the upload again.";
  }
  return "That upload didn't finish. Check your connection and try again — it resumes where it stopped.";
}

function sendResumable(
  supabase: Supabase,
  input: { file: File; path: string; contentType: string; onProgress?: (fraction: number) => void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    void supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (!token) {
        reject(new Error("unauthorized"));
        return;
      }
      const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/$/, "");
      const upload = new TusUpload(input.file, {
        endpoint: `${base}/storage/v1/upload/resumable`,
        retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
        headers: { authorization: `Bearer ${token}`, "x-upsert": "false" },
        uploadDataDuringCreation: true,
        // Lets a retried chunk continue the same upload instead of starting over.
        removeFingerprintOnSuccess: true,
        chunkSize: CHUNK_BYTES,
        metadata: {
          bucketName: DOCUMENT_BUCKET,
          objectName: input.path,
          contentType: input.contentType,
          cacheControl: "3600",
        },
        onProgress: (sent, total) => input.onProgress?.(total > 0 ? sent / total : 0),
        onError: reject,
        onSuccess: () => resolve(),
      });
      upload.start();
    }, reject);
  });
}

/**
 * Put one file in the bucket and attach it to a document.
 *
 * Exported because replacing a document's file is the same three steps with a
 * `documentId` — the only difference is that the server versions what was there
 * instead of creating a row.
 */
export async function uploadDocumentFile(
  supabase: Supabase,
  input: {
    file: File;
    section: string;
    documentId?: string;
    onProgress?: (fraction: number) => void;
    /** The org's plan allowance; the server enforces it regardless. */
    allowance?: UploadAllowance;
  },
): Promise<
  { ok: true; documentId: string } | { ok: false; error: string; upgrade?: boolean }
> {
  const { file, section, documentId, onProgress, allowance } = input;

  // Check before minting anything, so an unsupported or over-plan file costs no
  // round trip and the operator hears the same sentence the server would say.
  const local = checkUploadCandidate({ name: file.name, size: file.size, type: file.type }, allowance);
  if (!local.ok) return { ok: false, error: local.reason, upgrade: local.upgrade };

  const ticket = await createUploadTicket({
    section,
    fileName: file.name,
    size: file.size,
    mimeType: file.type,
    documentId,
  });
  if (!ticket.ok) return { ok: false, error: ticket.error, upgrade: ticket.upgrade };

  try {
    await sendResumable(supabase, {
      file,
      path: ticket.path,
      contentType: ticket.contentType,
      onProgress,
    });
  } catch (err) {
    // Leave nothing half-made: the object if any of it landed, and the shell
    // row if this upload is the only reason it exists.
    await abandonUpload({ documentId: ticket.documentId, path: ticket.path });
    return { ok: false, error: uploadErrorMessage(err) };
  }

  const done = await finalizeUpload({ documentId: ticket.documentId, path: ticket.path });
  if (!done.ok) {
    await abandonUpload({ documentId: ticket.documentId, path: ticket.path });
    return { ok: false, error: done.error, upgrade: done.upgrade };
  }
  return { ok: true, documentId: ticket.documentId };
}

interface QueueItem {
  key: string;
  name: string;
  size: number;
  state: "waiting" | "uploading" | "done" | "failed";
  /** 0–1 while uploading. */
  progress: number;
  documentId?: string;
  error?: string;
  /** Refused because of the plan — offer the upgrade, not a retry. */
  upgrade?: boolean;
}

export function DocumentUploader({
  section,
  sectionLabel,
  allowance = { maxBytes: MAX_UPLOAD_BYTES, planLimited: false },
}: {
  /** Section (doc_type) uploaded files are filed under. */
  section: string;
  sectionLabel: string;
  /** What this org's plan allows (resolved on the server). */
  allowance?: UploadAllowance;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  // Archives waiting to be reviewed. A zip is a container, not a document: it is
  // never stored, so it goes to the import dialog instead of the upload path.
  // Reviewed one at a time — each dialog is a filing decision, not a progress bar.
  const [archives, setArchives] = useState<File[]>([]);
  const busy = useRef(false);

  const run = useCallback(
    async (dropped: File[]) => {
      if (dropped.length === 0) return;
      const zips = dropped.filter(isZipFile);
      const files = dropped.filter((f) => !isZipFile(f));
      if (zips.length > 0) setArchives((prev) => [...prev, ...zips]);
      if (files.length === 0) return;

      const items: QueueItem[] = files.map((f, i) => ({
        key: `${Date.now()}-${i}-${f.name}`,
        name: f.name,
        size: f.size,
        state: "waiting",
        progress: 0,
      }));
      // Keep finished rows on screen: after a twelve-file drop the operator
      // needs to see which two failed, not an empty box.
      setQueue((prev) => [...prev.filter((q) => q.state === "failed"), ...items]);

      const patch = (key: string, next: Partial<QueueItem>) =>
        setQueue((prev) => prev.map((q) => (q.key === key ? { ...q, ...next } : q)));

      busy.current = true;
      let landed = false;
      let cursor = 0;
      const worker = async () => {
        while (cursor < files.length) {
          const i = cursor++;
          const key = items[i].key;
          patch(key, { state: "uploading" });
          // Progress events fire per chunk; round to whole percents so a fast
          // connection does not re-render the list hundreds of times.
          let shown = -1;
          const result = await uploadDocumentFile(supabase, {
            file: files[i],
            section,
            allowance,
            onProgress: (f) => {
              const pct = Math.floor(f * 100);
              if (pct !== shown) {
                shown = pct;
                patch(key, { progress: f });
              }
            },
          });
          landed ||= result.ok;
          patch(
            key,
            result.ok
              ? { state: "done", progress: 1, documentId: result.documentId }
              : { state: "failed", error: result.error, upgrade: result.upgrade },
          );
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(PARALLEL_UPLOADS, files.length) }, () => worker()),
      );
      busy.current = false;
      if (landed) router.refresh();
    },
    [router, section, supabase, allowance],
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
          Filed under {sectionLabel} · PDF, Word, Excel, PowerPoint, text, image, or video · up to{" "}
          {formatBytes(allowance.maxBytes)} each
        </span>
        {allowance.planLimited ? (
          <span className="text-xs text-fg-muted">
            Free plan · files up to {formatBytes(allowance.maxBytes)}.{" "}
            <Link
              href="/wallet"
              onClick={(e) => e.stopPropagation()}
              className="text-gold-300 underline hover:text-gold-200"
            >
              Upgrade
            </Link>{" "}
            to upload up to {formatBytes(MAX_UPLOAD_BYTES)}.
          </span>
        ) : null}
        <span className="text-xs text-fg-muted">
          Drop a .zip to import a whole pack — its folders become sections.
        </span>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          multiple
          accept={`${ACCEPTED_DOCUMENT_ATTR},${ZIP_EXTENSION}`}
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
              className="relative overflow-hidden rounded-lg border border-line/60 bg-surface-0 px-3 py-1.5 text-xs"
            >
              {q.state === "uploading" ? (
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-gold-500/10 transition-[width] duration-200"
                  style={{ width: `${Math.round(q.progress * 100)}%` }}
                />
              ) : null}
              <span className="relative flex items-center gap-2">
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
                        ? `${Math.round(q.progress * 100)}%`
                        : "Queued"}
                </span>
                <span className="min-w-0 flex-1 truncate text-fg-secondary">{q.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-fg-muted">
                  {formatBytes(q.size)}
                </span>
                {q.state === "done" && q.documentId ? (
                  <Link
                    href={`/document/${q.documentId}/review`}
                    className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-gold-300 hover:underline"
                  >
                    Review with Earn →
                  </Link>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {archives.length > 0 ? (
        <ZipImport
          key={`${archives[0].name}-${archives[0].size}-${archives[0].lastModified}`}
          file={archives[0]}
          defaultSection={section}
          allowance={allowance}
          onClose={() => setArchives((prev) => prev.slice(1))}
        />
      ) : null}

      {failed.length > 0 ? (
        <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
          {failed.map((q) => (
            <p key={q.key} className="text-xs text-red-300">
              <span className="text-fg-secondary">{q.name}</span> — {q.error}
              {q.upgrade ? (
                <>
                  {" "}
                  <Link href="/wallet" className="font-medium text-gold-300 underline hover:text-gold-200">
                    Upgrade →
                  </Link>
                </>
              ) : null}
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
  allowance,
}: {
  documentId: string;
  section: string;
  hasFile: boolean;
  allowance?: UploadAllowance;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const inputId = useId();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [error, setError] = useState("");
  const [pct, setPct] = useState(0);
  const [upgrade, setUpgrade] = useState(false);

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
        {state === "busy" ? `${pct}%` : state === "error" ? "Retry" : hasFile ? "Replace" : "Attach"}
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
          const result = await uploadDocumentFile(supabase, {
            file,
            section,
            documentId,
            allowance,
            onProgress: (f) => setPct(Math.round(f * 100)),
          });
          setPct(0);
          if (result.ok) {
            setState("idle");
            setUpgrade(false);
            router.refresh();
          } else {
            setError(result.error);
            setUpgrade(Boolean(result.upgrade));
            setState("error");
          }
        }}
      />
      {state === "error" && upgrade ? (
        <Link
          href="/wallet"
          className="shrink-0 rounded-lg border border-gold-500/40 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/10"
        >
          Upgrade
        </Link>
      ) : null}
    </>
  );
}
