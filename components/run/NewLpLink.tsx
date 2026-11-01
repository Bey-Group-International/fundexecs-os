"use client";

// components/run/NewLpLink.tsx
// Make the unique link for a prospective LP. You say who they are and what kind of
// investor, then copy the link (or have it emailed) and send it.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLpLinkAction, emailLpLinkAction } from "@/app/(app)/[hub]/[module]/onboarding-link-actions";
import { DEFAULT_OWNER_THRESHOLD_PCT, LINK_TTL_DAYS, LP_TYPE_LABEL } from "@/lib/lp-wizard";
import type { LpType } from "@/lib/supabase/database.types";

const field =
  "w-full rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none";
const label = "font-mono text-[10px] uppercase tracking-wider text-fg-muted";
const primary =
  "rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50";

export function NewLpLink({ funds }: { funds: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lpName, setLpName] = useState("");
  const [lpEmail, setLpEmail] = useState("");
  const [lpType, setLpType] = useState<LpType>("individual");
  const [threshold, setThreshold] = useState(String(DEFAULT_OWNER_THRESHOLD_PCT));
  const [fundId, setFundId] = useState("");
  const [commitment, setCommitment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ sessionId: string; url: string; carried: Array<{ kind: string; checkedAt: string; expiresAt: string; namesMatch?: boolean }> } | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setLpName("");
    setLpEmail("");
    setLpType("individual");
    setThreshold(String(DEFAULT_OWNER_THRESHOLD_PCT));
    setFundId("");
    setCommitment("");
    setMade(null);
    setNote(null);
    setError(null);
  };

  const create = () =>
    startTransition(async () => {
      setError(null);
      const res = await createLpLinkAction({
        lpName,
        lpEmail,
        lpType,
        ownerThresholdPct: lpType === "entity" ? threshold : undefined,
        fundId,
        commitmentAmount: commitment,
      }).catch(() => ({ ok: false as const, error: "Couldn't do that. Try again." }));
      if (!res.ok) return setError(res.error);
      setMade({ sessionId: res.sessionId, url: res.url, carried: res.carried ?? [] });
      router.refresh();
    });

  const email = () =>
    startTransition(async () => {
      if (!made) return;
      setNote(null);
      const res = await emailLpLinkAction(made.sessionId).catch(() => ({ ok: false as const, error: "Couldn't do that. Try again." }));
      if (!res.ok) return setNote({ tone: "error", text: res.error });
      setNote(
        res.sent
          ? { tone: "ok", text: `Link emailed to ${lpEmail}.` }
          : { tone: "error", text: "The email couldn't be sent. Connect your mailbox, or copy the link and send it yourself." },
      );
    });

  if (!open) {
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)} className={primary}>
          + New LP link
        </button>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-base font-semibold text-fg-primary">New LP link</h3>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="text-xs text-fg-muted hover:text-fg-secondary"
        >
          Close
        </button>
      </div>

      {made ? (
        <div className="mt-3 grid gap-3">
          <p className="text-sm text-fg-secondary">
            Send this link to {lpName}. They&apos;ll confirm it&apos;s them with a code we email, then complete the setup. It works for {LINK_TTL_DAYS} days.
          </p>
          {made.carried.some((c) => c.kind === "identity") ? (
            <p role="status" className="text-sm text-amber-300">
              {lpName} was approved before, with an ID check of{" "}
              {new Date(made.carried.find((c) => c.kind === "identity")!.checkedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.
              It is not used yet: open their card below and confirm it is the same person. Until you do, they&apos;ll verify their ID themselves.
              {made.carried.find((c) => c.kind === "identity")!.namesMatch === false ? " The names on the two onboardings differ." : ""}
            </p>
          ) : null}
          <p className="break-all rounded-lg border border-line bg-surface-0 px-3 py-2 font-mono text-[11px] text-fg-primary">{made.url}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={primary}
              onClick={() =>
                navigator.clipboard?.writeText(made.url).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              {copied ? "Copied ✓" : "Copy link"}
            </button>
            <button type="button" disabled={pending} onClick={email} className={primary}>
              Email it for me
            </button>
            <button type="button" className="text-xs text-fg-muted hover:text-fg-secondary" onClick={reset}>
              Make another
            </button>
          </div>
          {note ? (
            <p role={note.tone === "error" ? "alert" : "status"} className={`text-xs ${note.tone === "error" ? "text-amber-400" : "text-emerald-300"}`}>
              {note.text}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={label}>LP&apos;s name</span>
              <input aria-label="LP name" value={lpName} maxLength={200} onChange={(e) => setLpName(e.target.value)} className={`${field} mt-1`} />
            </label>
            <label className="block">
              <span className={label}>LP&apos;s email</span>
              <input aria-label="LP email" type="email" value={lpEmail} maxLength={254} onChange={(e) => setLpEmail(e.target.value)} className={`${field} mt-1`} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={label}>Kind of LP</span>
              <select aria-label="Kind of LP" value={lpType} onChange={(e) => setLpType(e.target.value as LpType)} className={`${field} mt-1`}>
                {(Object.keys(LP_TYPE_LABEL) as LpType[]).map((t) => (
                  <option key={t} value={t}>
                    {LP_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            {lpType === "entity" ? (
              <label className="block">
                <span className={label}>List owners holding at least (%)</span>
                <input aria-label="Ownership threshold" inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} className={`${field} mt-1`} />
              </label>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={label}>Fund (optional)</span>
              <select aria-label="Fund" value={fundId} onChange={(e) => setFundId(e.target.value)} className={`${field} mt-1`}>
                <option value="">No fund yet</option>
                {funds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>Commitment, USD (optional)</span>
              <input aria-label="Commitment" inputMode="decimal" value={commitment} onChange={(e) => setCommitment(e.target.value)} className={`${field} mt-1`} />
            </label>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-amber-400">
              {error}
            </p>
          ) : null}
          <div>
            <button type="button" disabled={pending} onClick={create} className={primary}>
              {pending ? "Making…" : "Make link"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
