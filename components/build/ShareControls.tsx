"use client";

import { useEffect, useState, useTransition } from "react";
import { inputClass } from "./DraftWithEarn";
import { createShare, revokeShare } from "./materials-actions";

// Section keys the GP can selectively expose — matches DATA_ROOM_SECTIONS keys.
const ALL_SECTIONS: { key: string; label: string }[] = [
  { key: "overview", label: "Fund Overview" },
  { key: "marketing", label: "Marketing" },
  { key: "thesis", label: "Investment Thesis" },
  { key: "track_record", label: "Track Record" },
  { key: "portfolio", label: "Portfolio" },
  { key: "team", label: "Team" },
  { key: "fund_terms", label: "Fund Terms" },
  { key: "legal", label: "Legal" },
  { key: "financials", label: "Financials" },
  { key: "compliance", label: "Compliance" },
  { key: "operations", label: "Operations" },
  { key: "esg", label: "ESG" },
  { key: "risk", label: "Risk" },
  { key: "diligence", label: "Diligence" },
  { key: "references", label: "References" },
];

export interface ShareView {
  id: string;
  token: string;
  label: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string | null;
  allowed_sections: string[] | null;
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
      {/* URL preview strip + section scope */}
      {live ? (
        <div className="border-t border-line/50 bg-surface-0 px-4 py-2">
          <p className="truncate font-mono text-[9px] text-fg-muted">{url}</p>
          {share.allowed_sections && share.allowed_sections.length > 0 ? (
            <p className="mt-1 font-mono text-[9px] text-fg-muted/70">
              Sections: {share.allowed_sections.join(", ")}
            </p>
          ) : (
            <p className="mt-1 font-mono text-[9px] text-fg-muted/50">Full data room</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function CreateShareForm({ onDone }: { onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [requireEmail, setRequireEmail] = useState(false);
  const [requireNda, setRequireNda] = useState(false);
  const [showNdaText, setShowNdaText] = useState(false);
  const [requirePassword, setRequirePassword] = useState(false);
  const [notifyOnOpen, setNotifyOnOpen] = useState(false);
  const [limitSections, setLimitSections] = useState(false);
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set());

  function toggleSection(key: string) {
    setSelectedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <form
      action={(fd) => {
        if (limitSections && selectedSections.size > 0) {
          fd.set("allowed_sections", JSON.stringify([...selectedSections]));
        }
        startTransition(async () => {
          await createShare(fd);
          onDone();
        });
      }}
      className="mb-4 rounded-xl border border-gold-500/20 bg-surface-1 p-4"
    >
      {/* Basic fields */}
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="label" placeholder="Label (e.g. 'Q3 2025 raise')" className={inputClass} />
        <input
          name="expires_in_days"
          type="number"
          min={1}
          placeholder="Expires in days (optional)"
          className={inputClass}
        />
      </div>

      {/* Recipient */}
      <div className="mt-3">
        <input
          name="recipient_email"
          type="email"
          placeholder="Recipient email (optional — sends them the link automatically)"
          className={inputClass}
        />
      </div>

      {/* Gate toggles */}
      <div className="mt-4 space-y-2 rounded-lg border border-line bg-surface-0 p-3">
        <p className="mb-2 font-mono text-[9px] uppercase tracking-wider text-fg-muted">Access gates</p>

        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            name="require_email"
            value="1"
            checked={requireEmail}
            onChange={(e) => setRequireEmail(e.target.checked)}
            className="h-3.5 w-3.5 accent-gold-400"
          />
          <span className="text-sm text-fg-secondary">Require viewer email</span>
        </label>

        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            name="require_nda"
            value="1"
            checked={requireNda}
            onChange={(e) => {
              setRequireNda(e.target.checked);
              if (!e.target.checked) setShowNdaText(false);
            }}
            className="h-3.5 w-3.5 accent-gold-400"
          />
          <span className="text-sm text-fg-secondary">Require NDA acceptance</span>
          {requireNda && (
            <button
              type="button"
              onClick={() => setShowNdaText((v) => !v)}
              className="ml-auto font-mono text-[9px] uppercase tracking-wider text-gold-400 hover:text-gold-300"
            >
              {showNdaText ? "Hide text" : "Custom text"}
            </button>
          )}
        </label>
        {requireNda && showNdaText && (
          <textarea
            name="nda_text"
            rows={4}
            placeholder="Custom NDA text (leave blank to use default)"
            className={`${inputClass} mt-1 resize-none text-xs`}
          />
        )}

        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={requirePassword}
            onChange={(e) => setRequirePassword(e.target.checked)}
            className="h-3.5 w-3.5 accent-gold-400"
          />
          <span className="text-sm text-fg-secondary">Password protect</span>
        </label>
        {requirePassword && (
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Set a password"
            className={`${inputClass} mt-1`}
          />
        )}

        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            name="notify_on_open"
            value="1"
            checked={notifyOnOpen}
            onChange={(e) => setNotifyOnOpen(e.target.checked)}
            className="h-3.5 w-3.5 accent-gold-400"
          />
          <span className="text-sm text-fg-secondary">Notify me when this link is opened</span>
        </label>
      </div>

      {/* Section scope */}
      <div className="mt-3 space-y-2 rounded-lg border border-line bg-surface-0 p-3">
        <p className="mb-2 font-mono text-[9px] uppercase tracking-wider text-fg-muted">Scope</p>
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={limitSections}
            onChange={(e) => {
              setLimitSections(e.target.checked);
              if (!e.target.checked) setSelectedSections(new Set());
            }}
            className="h-3.5 w-3.5 accent-gold-400"
          />
          <span className="text-sm text-fg-secondary">Limit to specific sections</span>
        </label>
        {limitSections && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ALL_SECTIONS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => toggleSection(s.key)}
                className={`rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider transition ${
                  selectedSections.has(s.key)
                    ? "border-gold-500/60 bg-gold-500/15 text-gold-300"
                    : "border-line text-fg-muted hover:border-gold-500/30 hover:text-fg-secondary"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          disabled={pending}
          className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create link"}
        </button>
        <p className="text-xs text-fg-muted">
          {limitSections && selectedSections.size > 0
            ? `${selectedSections.size} section${selectedSections.size > 1 ? "s" : ""} will be visible`
            : "Full data room — anyone with the link can view"}
        </p>
      </div>
    </form>
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
        <CreateShareForm onDone={() => setOpen(false)} />
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
