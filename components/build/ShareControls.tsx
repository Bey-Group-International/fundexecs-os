"use client";

import { useEffect, useState, useTransition } from "react";
import { inputClass } from "./DraftWithEarn";
import { createShare, revokeShare } from "./materials-actions";

export interface ShareView {
  id: string;
  token: string;
  label: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string | null;
}

function status(s: ShareView): { label: string; tone: string } {
  if (s.revoked_at) return { label: "Revoked", tone: "text-fg-muted" };
  if (s.expires_at && new Date(s.expires_at).getTime() < Date.now())
    return { label: "Expired", tone: "text-fg-muted" };
  return { label: "Active", tone: "text-emerald-300" };
}

function ShareRow({ share }: { share: ShareView }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => setOrigin(window.location.origin), []);

  const url = `${origin}/dataroom/${share.token}`;
  const st = status(share);
  const live = st.label === "Active";

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-1">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        {/* Status dot + label */}
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-fg-muted/40"}`} />
          <span className={`font-mono text-[9px] uppercase tracking-wider ${live ? "text-emerald-400" : "text-fg-muted"}`}>
            {st.label}
          </span>
        </div>

        <span className="text-sm font-medium text-fg-primary">{share.label || "Untitled link"}</span>

        {share.expires_at && !share.revoked_at ? (
          <span className="font-mono text-[9px] text-fg-muted">
            exp {new Date(share.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        ) : null}

        {live ? (
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(url).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20"
            >
              {copied ? "Copied ✓" : "Copy link"}
            </button>
            <form action={(fd) => startTransition(async () => { await revokeShare(fd); })}>
              <input type="hidden" name="id" value={share.id} />
              <button
                disabled={pending}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-muted transition hover:border-red-500/40 hover:text-red-400 disabled:opacity-50"
              >
                Revoke
              </button>
            </form>
          </div>
        ) : null}
      </div>
      {/* URL preview strip */}
      {live ? (
        <div className="border-t border-line/50 bg-surface-0 px-4 py-1.5">
          <p className="truncate font-mono text-[9px] text-fg-muted">{url}</p>
        </div>
      ) : null}
    </div>
  );
}

// Create + manage read-only public links to the data room.
export function ShareControls({ shares, activeCount }: { shares: ShareView[]; activeCount?: number }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const active = shares.filter((s) => !s.revoked_at);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold tracking-tight text-fg-primary">Share</h3>
          <p className="mt-0.5 text-sm text-fg-secondary">
            Read-only links for LPs, co-investors, lenders, and partners — no account required.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20"
        >
          {open ? "Cancel" : "+ New link"}
        </button>
      </div>

      {open ? (
        <form
          action={(fd) => startTransition(async () => { await createShare(fd); setOpen(false); })}
          className="mb-4 rounded-xl border border-gold-500/20 bg-surface-1 p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <input name="label" placeholder="Label (e.g. 'Q3 2025 raise')" className={inputClass} />
            <input name="expires_in_days" type="number" min={1} placeholder="Expires in days (optional)" className={inputClass} />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              disabled={pending}
              className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-60"
            >
              {pending ? "Creating…" : "Create link"}
            </button>
            <p className="text-xs text-fg-muted">Anyone with the link can view — no login required.</p>
          </div>
        </form>
      ) : null}

      {active.length === 0 && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-xl border border-dashed border-line bg-surface-1 px-4 py-8 text-center transition hover:border-gold-500/40 hover:bg-gold-500/5"
        >
          <p className="text-sm text-fg-muted">No active links.</p>
          <p className="mt-1 text-xs text-gold-400">Click to create a shareable link →</p>
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          {active.map((s) => (
            <ShareRow key={s.id} share={s} />
          ))}
        </div>
      )}
    </div>
  );
}
