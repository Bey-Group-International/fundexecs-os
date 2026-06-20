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
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-1 px-3 py-2">
      <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{st.label}</span>
      <span className="text-sm text-fg-primary">{share.label || "Untitled link"}</span>
      {share.expires_at && !share.revoked_at ? (
        <span className="font-mono text-[10px] text-fg-muted">
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
            className="rounded-md border border-gold-500/40 bg-gold-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-gold-300 hover:bg-gold-500/20"
          >
            {copied ? "Copied ✓" : "Copy link"}
          </button>
          <form action={(fd) => startTransition(async () => { await revokeShare(fd); })}>
            <input type="hidden" name="id" value={share.id} />
            <button disabled={pending} className="rounded-md border border-line px-2 py-1 text-xs text-fg-muted hover:border-red-500/40 hover:text-red-400 disabled:opacity-50">
              Revoke
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

// Create + manage read-only public links to the data room.
export function ShareControls({ shares }: { shares: ShareView[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const active = shares.filter((s) => !s.revoked_at);

  return (
    <div className="mx-auto mt-8 max-w-2xl print:hidden">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold tracking-tight text-fg-primary">Share</h3>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-gold-500/40 bg-gold-500/10 px-2.5 py-1.5 text-xs font-medium text-gold-300 hover:bg-gold-500/20"
        >
          + New link
        </button>
      </div>
      <p className="mb-3 text-sm text-fg-secondary">
        Read-only links anyone can open without an account — for LPs, co-investors, lenders, and partners.
      </p>

      {open ? (
        <form
          action={(fd) => startTransition(async () => { await createShare(fd); setOpen(false); })}
          className="mb-4 grid gap-3 rounded-xl border border-line bg-surface-1 p-4 sm:grid-cols-2"
        >
          <input name="label" placeholder="Label (e.g. 'Q3 raise')" className={inputClass} />
          <input name="expires_in_days" type="number" min={1} placeholder="Expires in days (optional)" className={inputClass} />
          <div className="sm:col-span-2">
            <button disabled={pending} className="rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 hover:bg-gold-300 disabled:opacity-60">
              {pending ? "Creating…" : "Create link"}
            </button>
          </div>
        </form>
      ) : null}

      {active.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-1 px-4 py-6 text-center text-sm text-fg-muted">
          No active links. Create one to share these materials.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {active.map((s) => (
            <ShareRow key={s.id} share={s} />
          ))}
        </div>
      )}
    </div>
  );
}
