"use client";

// Share a moment of a recording: pick a window, a label, how long the link
// lives and whether viewers may save a copy; get a link anyone can open — and
// see, change and revoke the links already made, with who has opened them.
// The server cuts the window into a file of its own; the link serves nothing
// outside it.

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_SHARE_DAYS,
  MAX_CLIP_MS,
  SHARE_DAYS,
  agoLabel,
  clipStatusLabel,
  expiryLabel,
  formatClock,
  parseClock,
  shareState,
  type ClipStatus,
  type ShareView,
} from "@/lib/meetings/recording-share";

interface ShareSummary {
  id: string;
  label: string | null;
  startMs: number;
  endMs: number | null;
  expiresAt: string;
  revokedAt: string | null;
  openCount: number;
  lastOpenedAt: string | null;
  createdAt: string;
  clipStatus?: ClipStatus;
  clipError?: string | null;
  allowDownload?: boolean;
}

/** One link's access log, loaded when its creator opens it. */
function ShareActivity({ shareId, now }: { shareId: string; now: number }) {
  const [state, setState] = useState<{ views: ShareView[]; summary: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/recording-shares/${shareId}/views`, { cache: "no-store" });
        const body = (await res.json()) as { views?: ShareView[]; summary?: { text: string } };
        if (!cancelled) setState({ views: body.views ?? [], summary: body.summary?.text ?? "" });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  if (failed) return <p className="text-[var(--fg-muted)]">Couldn&apos;t load who opened this link.</p>;
  if (!state) return <p className="text-[var(--fg-muted)]">Loading…</p>;
  if (!state.views.length) return <p className="text-[var(--fg-muted)]">Nobody has opened this link yet.</p>;
  return (
    <div className="flex flex-col gap-1" data-share-activity>
      <p className="text-[var(--fg-secondary,var(--fg-primary))]">{state.summary}</p>
      <ul className="flex flex-col gap-0.5" aria-label="Link activity">
        {state.views.slice(0, 20).map((v, i) => (
          <li key={`${v.createdAt}-${i}`} className="flex justify-between gap-2 text-[var(--fg-muted)]">
            <span className="truncate">
              {v.kind === "download" ? "Downloaded" : "Opened"} · {v.device ?? "Unknown device"}
            </span>
            <span className="shrink-0 tabular-nums" title={new Date(v.createdAt).toLocaleString()}>
              {agoLabel(v.createdAt, now)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ShareClipDialog({
  meetingId,
  recordingId,
  atMs,
  durationMs,
  onClose,
}: {
  meetingId: string;
  recordingId: string;
  /** Where the viewer was when they asked: the clip's default start. */
  atMs: number;
  /** The recording's length, when known, to keep the default end inside it. */
  durationMs?: number | null;
  onClose: () => void;
}) {
  const base = `/api/meetings/${meetingId}/recording/${recordingId}/shares`;
  const startDefault = Math.max(0, Math.floor(atMs / 1000) * 1000);
  const endDefault = durationMs ? Math.min(durationMs, startDefault + 60_000) : startDefault + 60_000;

  const [start, setStart] = useState(formatClock(startDefault));
  const [end, setEnd] = useState(formatClock(endDefault));
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<number>(DEFAULT_SHARE_DAYS);
  const [allowDownload, setAllowDownload] = useState(false);
  const [openActivity, setOpenActivity] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shares, setShares] = useState<ShareSummary[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { shares?: ShareSummary[] };
      setShares(body.shares ?? []);
    } catch {
      // The list is a convenience; making a link still works without it.
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const s = parseClock(start);
    const en = parseClock(end);
    if (s === null || en === null) {
      setError("Use times like 2:10 or 1:02:03.");
      return;
    }
    if (en <= s) {
      setError("The end has to come after the start.");
      return;
    }
    if (en - s > MAX_CLIP_MS) {
      setError(`A clip can be at most ${MAX_CLIP_MS / 60_000} minutes. Download the recording to share more.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startMs: s, endMs: en, label, days, allowDownload }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setError(body.error ?? "Couldn't make a link. Try again.");
        return;
      }
      setUrl(body.url);
      setCopied(false);
      void load();
    } catch {
      setError("Couldn't make a link. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function change(id: string, patch: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/recording-shares/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return;
      const body = (await res.json()) as { share?: ShareSummary };
      if (body.share) setShares((prev) => prev.map((x) => (x.id === id ? { ...x, ...body.share } : x)));
    } catch {
      // Left as it was.
    }
  }

  // A clip still being cut is checked again shortly, so the list shows when it is ready.
  const preparing = shares.some(
    (x) => (x.clipStatus === "pending" || x.clipStatus === "processing") && !x.revokedAt && Date.parse(x.expiresAt) > Date.now(),
  );
  useEffect(() => {
    if (!preparing) return;
    const t = window.setTimeout(() => void load(), 5000);
    return () => window.clearTimeout(t);
  }, [preparing, shares, load]);

  async function revoke(id: string) {
    try {
      const res = await fetch(`/api/recording-shares/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revoke: true }),
      });
      if (res.ok) {
        setShares((prev) => prev.map((x) => (x.id === id ? { ...x, revokedAt: new Date().toISOString() } : x)));
      }
    } catch {
      // Left as it was; the row still shows it as live.
    }
  }

  const now = Date.now();
  const field =
    "w-full rounded-md border border-[var(--line)] bg-[var(--surface-0)] px-2 py-1.5 text-sm text-[var(--fg-primary)]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Share a clip"
        className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-xl sm:rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--fg-primary)]">Share a clip</h2>
            <p className="text-xs text-[var(--fg-muted)]">
              Anyone with the link can watch this part — and only this part — until it expires.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--fg-muted)] hover:text-[var(--fg-primary)] px-2">
            ×
          </button>
        </div>

        <form onSubmit={create} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-[var(--fg-muted)]">
              Start
              <input className={field} value={start} onChange={(e) => setStart(e.target.value)} inputMode="numeric" aria-label="Clip start" />
            </label>
            <label className="text-xs text-[var(--fg-muted)]">
              End
              <input className={field} value={end} onChange={(e) => setEnd(e.target.value)} inputMode="numeric" aria-label="Clip end" />
            </label>
          </div>
          <label className="text-xs text-[var(--fg-muted)]">
            Label (optional)
            <input className={field} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="Pricing discussion" aria-label="Clip label" />
          </label>
          <label className="text-xs text-[var(--fg-muted)]">
            Link expires after
            <select className={field} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Link expires after">
              {SHARE_DAYS.map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? "1 day" : `${d} days`}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-2 text-xs text-[var(--fg-muted)]">
            <input
              type="checkbox"
              checked={allowDownload}
              onChange={(e) => setAllowDownload(e.target.checked)}
              className="mt-0.5"
              aria-label="Let viewers download the clip"
            />
            <span>
              Let viewers download the clip
              <span className="block">Off: it can only be watched in the browser.</span>
            </span>
          </label>
          {error && (
            <p role="alert" className="text-xs text-[var(--status-danger,#ef4444)]">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="self-start rounded-md bg-[var(--gold-400)] px-3 py-1.5 text-sm font-medium text-black disabled:opacity-60"
          >
            {busy ? "Making link…" : "Make link"}
          </button>
        </form>

        {url && (
          <p className="mt-4 text-xs text-[var(--fg-muted)]">
            The clip is being prepared — the link starts working in a minute or so. You can send it now.
          </p>
        )}
        {url && (
          <div className="mt-2 flex items-center gap-2" data-clip-url>
            <input readOnly value={url} aria-label="Clip link" className={field} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" onClick={copy} className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--fg-primary)]">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}

        {shares.length > 0 && (
          <div className="mt-5">
            <h3 className="text-xs font-semibold text-[var(--fg-secondary,var(--fg-primary))] mb-2">Links you&apos;ve made</h3>
            <ul className="flex flex-col gap-2" aria-label="Clip links">
              {shares.map((s) => {
                const state = shareState({ expires_at: s.expiresAt, revoked_at: s.revokedAt }, now);
                const status = s.clipStatus ?? "pending";
                return (
                  <li key={s.id} className="flex flex-col gap-1 text-xs" data-share-state={state} data-clip-status={status}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[var(--fg-primary)]">
                          {s.label ?? "Clip"} · {formatClock(s.startMs)}
                          {s.endMs !== null ? `–${formatClock(s.endMs)}` : ""}
                        </div>
                        <div className="text-[var(--fg-muted)]">
                          {expiryLabel({ expires_at: s.expiresAt, revoked_at: s.revokedAt }, now)}
                          {state === "active" && status !== "ready" ? ` · ${clipStatusLabel(status)}` : ""} · opened {s.openCount}{" "}
                          {s.openCount === 1 ? "time" : "times"}
                        </div>
                        {state === "active" && status === "failed" && s.clipError ? (
                          <div className="text-[var(--status-danger,#ef4444)]">{s.clipError}</div>
                        ) : null}
                      </div>
                      {state === "active" && (
                        <button
                          type="button"
                          onClick={() => revoke(s.id)}
                          className="shrink-0 text-[var(--fg-muted)] hover:text-[var(--status-danger,#ef4444)]"
                          aria-label={`Revoke ${s.label ?? "clip"} link`}
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-[var(--fg-muted)]">
                      {state === "active" && (
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={s.allowDownload === true}
                            onChange={(e) => void change(s.id, { allowDownload: e.target.checked })}
                            aria-label={`Allow downloads of ${s.label ?? "clip"}`}
                          />
                          Downloads allowed
                        </label>
                      )}
                      {state === "active" && status === "failed" && (
                        <button type="button" onClick={() => void change(s.id, { retry: true })} className="underline hover:text-[var(--fg-primary)]">
                          Try again
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setOpenActivity((cur) => (cur === s.id ? null : s.id))}
                        aria-expanded={openActivity === s.id}
                        className="underline hover:text-[var(--fg-primary)]"
                      >
                        {openActivity === s.id ? "Hide activity" : "Who opened it"}
                      </button>
                    </div>
                    {openActivity === s.id && <ShareActivity shareId={s.id} now={now} />}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
