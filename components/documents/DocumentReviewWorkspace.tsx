"use client";

// The review page's working surface: the file as-is on the left, Earn on the
// right — its recommended adjustments, accept-as-complete, and a preview link.
//
// Earn recommends; the operator decides. Adjustments are made to the original
// and re-uploaded with Replace, which versions the old file and gets a fresh
// review. Accepting marks the document Ready. Sharing is pre-filled by Earn and
// sent only when the operator presses Create.
import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePreview } from "./FilePreview";
import { ReplaceFileButton } from "./DocumentUploader";
import {
  acceptDocument,
  createDocumentShare,
  refileDocument,
  reopenDocument,
  runDocumentReview,
} from "./review-actions";
import { revokeShare } from "@/components/build/materials-actions";
import type { PreviewKind, UploadAllowance } from "@/lib/document-files";
import type { ShareSuggestion } from "@/lib/document-review";
import type { DocumentReview, DocumentStatus } from "@/lib/supabase/database.types";

interface DocLink {
  id: string;
  label: string | null;
  url: string;
  expiresAt: string | null;
  allowDownload: boolean;
  watermark: boolean;
  requireNda: boolean;
}

const SEVERITY_STYLE = {
  blocker: "border-red-500/40 bg-red-500/10 text-red-300",
  suggestion: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  nit: "border-line bg-surface-0 text-fg-muted",
} as const;

export function DocumentReviewWorkspace({
  doc,
  sections,
  initialReview,
  shareDefaults,
  links,
  canWrite,
  allowance,
}: {
  doc: { id: string; name: string; section: string; status: DocumentStatus; previewKind: PreviewKind };
  sections: { key: string; label: string }[];
  initialReview: DocumentReview | null;
  shareDefaults: ShareSuggestion;
  links: DocLink[];
  canWrite: boolean;
  allowance?: UploadAllowance;
}) {
  const router = useRouter();
  const [review, setReview] = useState<DocumentReview | null>(initialReview);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  const label = useCallback((key: string | null) => sections.find((s) => s.key === key)?.label ?? "Other Materials", [sections]);

  const review_ = useCallback(
    async (force: boolean) => {
      setReviewing(true);
      setReviewError(null);
      const res = await runDocumentReview(doc.id, { force });
      setReviewing(false);
      if (res.ok) setReview(res.review);
      else setReviewError(res.error);
    },
    [doc.id],
  );

  // First visit: Earn reads the file without being asked. The page renders the
  // preview immediately and the review arrives beside it.
  useEffect(() => {
    if (!initialReview) void review_(false);
  }, [initialReview, review_]);

  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setActionError(null);
      const res = await fn();
      if (res.ok) router.refresh();
      else setActionError(res.error);
    });

  const blockers = review?.recommendations.filter((r) => r.severity === "blocker").length ?? 0;
  const moveTo =
    review?.suggested_section && review.suggested_section !== doc.section ? review.suggested_section : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      {/* ------------------------------------------------------------ File */}
      <section className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <a
            href={`/api/documents/${doc.id}/file`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-line px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300"
          >
            Open in new tab
          </a>
          <a
            href={`/api/documents/${doc.id}/file?download=1`}
            className="rounded-lg border border-line px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300"
          >
            Download
          </a>
          {canWrite ? <ReplaceFileButton documentId={doc.id} section={doc.section} hasFile allowance={allowance} /> : null}
          <span className="ml-auto font-mono text-[11px] text-fg-muted">
            Shown as uploaded
          </span>
        </div>
        <FilePreview
          kind={doc.previewKind}
          src={`/api/documents/${doc.id}/file`}
          previewUrl={`/api/documents/${doc.id}/preview`}
          name={doc.name}
        />
      </section>

      {/* ------------------------------------------------------------- Earn */}
      <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[calc(var(--app-header-h)+1.5rem)] lg:max-h-[calc(100dvh-var(--app-header-h)-3rem)] lg:self-start lg:overflow-y-auto">
        {/* Review */}
        <div className="rounded-2xl border border-line bg-surface-1 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">Earn&apos;s review</p>
            <button
              type="button"
              onClick={() => void review_(true)}
              disabled={reviewing}
              className="font-mono text-[11px] uppercase tracking-wider text-fg-muted hover:text-gold-300 disabled:opacity-50"
            >
              {reviewing ? "Reading…" : review ? "Review again" : "Review"}
            </button>
          </div>

          {reviewing && !review ? (
            <p className="mt-3 text-sm text-fg-muted">Earn is reading {doc.name}…</p>
          ) : reviewError ? (
            <p className="mt-3 text-sm text-red-300">{reviewError}</p>
          ) : review ? (
            <>
              <p className="mt-3 text-sm leading-relaxed text-fg-secondary">{review.summary}</p>

              {review.recommendations.length === 0 ? (
                <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                  No adjustments recommended.
                </p>
              ) : (
                <ol className="mt-3 flex flex-col gap-2">
                  {review.recommendations.map((r, i) => (
                    <li key={i} className="rounded-lg border border-line bg-surface-0 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${SEVERITY_STYLE[r.severity]}`}
                        >
                          {r.severity === "blocker" ? "Fix first" : r.severity}
                        </span>
                        <p className="min-w-0 text-sm font-medium text-fg-primary">{r.title}</p>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-fg-secondary">{r.detail}</p>
                      {r.location ? (
                        <p className="mt-1 truncate font-mono text-[11px] text-fg-muted" title={r.location}>
                          {r.location}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}

              {moveTo ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-gold-500/30 bg-gold-500/5 px-3 py-2">
                  <p className="text-xs text-fg-secondary">
                    Belongs in <span className="text-fg-primary">{label(moveTo)}</span>, not {label(doc.section)}.
                  </p>
                  {canWrite ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => act(() => refileDocument(doc.id, moveTo))}
                      className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-gold-300 hover:underline disabled:opacity-50"
                    >
                      Move
                    </button>
                  ) : null}
                </div>
              ) : null}

              <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                {review.source === "earn" ? "Reviewed by Earn" : "Automated checks"} ·{" "}
                {new Date(review.reviewed_at).toLocaleString()} · To adjust, edit the original and Replace it.
              </p>
            </>
          ) : null}
        </div>

        {/* Accept */}
        <div className="rounded-2xl border border-line bg-surface-1 p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">Status</p>
          {doc.status === "ready" ? (
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-sm text-emerald-300">Accepted as complete</p>
              {canWrite ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(() => reopenDocument(doc.id))}
                  className="font-mono text-[11px] uppercase tracking-wider text-fg-muted hover:text-fg-secondary disabled:opacity-50"
                >
                  Reopen
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <p className="mt-2 text-xs text-fg-secondary">
                {blockers > 0
                  ? `Earn flagged ${blockers} item${blockers > 1 ? "s" : ""} to fix first. You can still accept it if you've handled them.`
                  : "Accepting marks the document Ready."}
              </p>
              {canWrite ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(() => acceptDocument(doc.id))}
                  className="mt-3 w-full rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
                >
                  {pending ? "…" : "Accept as complete"}
                </button>
              ) : null}
            </>
          )}
          {actionError ? <p className="mt-2 text-xs text-red-300">{actionError}</p> : null}
        </div>

        {/* Share */}
        {canWrite ? <SharePanel docId={doc.id} defaults={shareDefaults} links={links} /> : null}
      </aside>
    </div>
  );
}

function SharePanel({ docId, defaults, links }: { docId: string; defaults: ShareSuggestion; links: DocLink[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    label: defaults.label,
    expiresInDays: String(defaults.expiresInDays),
    requireEmail: defaults.requireEmail,
    requireNda: defaults.requireNda,
    allowDownload: defaults.allowDownload,
    watermark: defaults.watermark,
    password: "",
    recipientEmail: "",
    notifyOnOpen: true,
  });
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(url);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const days = Number(form.expiresInDays);
      const res = await createDocumentShare({
        documentId: docId,
        label: form.label,
        expiresInDays: Number.isFinite(days) && days > 0 ? days : null,
        requireEmail: form.requireEmail,
        requireNda: form.requireNda,
        password: form.password,
        recipientEmail: form.recipientEmail,
        allowDownload: form.allowDownload,
        watermark: form.watermark,
        notifyOnOpen: form.notifyOnOpen,
      });
      if (res.ok) {
        setCreated(res.url);
        setOpen(false);
        router.refresh();
      } else setError(res.error);
    });

  const toggle = (key: "requireEmail" | "requireNda" | "allowDownload" | "watermark" | "notifyOnOpen", text: string) => (
    <label className="flex items-center gap-2 text-xs text-fg-secondary">
      <input
        type="checkbox"
        checked={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
        className="accent-gold-500"
      />
      {text}
    </label>
  );

  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">Share a preview</p>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="font-mono text-[11px] uppercase tracking-wider text-gold-300 hover:underline"
          >
            New link
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-fg-muted">A link that opens only this document in the investor viewer.</p>

      {created ? (
        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
          <p className="text-xs text-emerald-300">Link created{form.recipientEmail ? ` and sent to ${form.recipientEmail}` : ""}.</p>
          <button
            type="button"
            onClick={() => copy(created)}
            className="mt-1 w-full truncate text-left font-mono text-[11px] text-fg-secondary hover:text-gold-300"
            title="Copy link"
          >
            {copied === created ? "Copied" : created}
          </button>
        </div>
      ) : null}

      {open ? (
        <div className="mt-3 flex flex-col gap-2.5">
          <p className="rounded-lg border border-gold-500/20 bg-gold-500/5 px-3 py-2 text-xs leading-relaxed text-fg-secondary">
            <span className="text-gold-300">Earn suggests:</span> {defaults.rationale}
          </p>
          <input
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            placeholder="Link name"
            aria-label="Link name"
            className="rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary focus:border-gold-500/60 focus:outline-none"
          />
          <input
            value={form.recipientEmail}
            onChange={(e) => setForm((f) => ({ ...f, recipientEmail: e.target.value }))}
            placeholder="Send to (optional) — lp@example.com"
            aria-label="Recipient email"
            type="email"
            className="rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary focus:border-gold-500/60 focus:outline-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
              Expires in (days)
              <input
                value={form.expiresInDays}
                onChange={(e) => setForm((f) => ({ ...f, expiresInDays: e.target.value.replace(/\D/g, "") }))}
                inputMode="numeric"
                className="rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary focus:border-gold-500/60 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
              Password (optional)
              <input
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                type="password"
                autoComplete="new-password"
                className="rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary focus:border-gold-500/60 focus:outline-none"
              />
            </label>
          </div>
          <div className="flex flex-col gap-1.5">
            {toggle("requireEmail", "Ask for the reader's email")}
            {toggle("requireNda", "Require NDA before viewing")}
            {toggle("allowDownload", "Allow download (off = view-only)")}
            {toggle("watermark", "Watermark PDFs with the reader's email")}
            {toggle("notifyOnOpen", "Tell me when it's opened")}
          </div>
          {error ? <p className="text-xs text-red-300">{error}</p> : null}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={submit}
              className="flex-1 rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
            >
              {pending ? "Creating…" : form.recipientEmail ? "Create & send" : "Create link"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="font-mono text-[11px] uppercase tracking-wider text-fg-muted hover:text-fg-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {links.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => copy(l.url)}
                title="Copy link"
                className="min-w-0 flex-1 truncate text-left text-fg-secondary hover:text-gold-300"
              >
                {copied === l.url ? "Copied" : (l.label ?? "Link")}
              </button>
              <span className="shrink-0 font-mono text-[10px] uppercase text-fg-muted">
                {[l.requireNda ? "NDA" : null, l.allowDownload ? null : "view-only", l.watermark ? "wm" : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <form
                action={async (fd) => {
                  await revokeShare(fd);
                  router.refresh();
                }}
              >
                <input type="hidden" name="id" value={l.id} />
                <button
                  type="submit"
                  className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-fg-muted hover:text-red-400"
                >
                  Revoke
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
