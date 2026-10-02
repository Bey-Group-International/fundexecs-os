"use client";

// Links into one room. Scoping choices offer only the sections this room
// actually publishes — a link can never expose something that was never
// published, and the operator isn't picking from a list of sections that don't
// exist here.
import { useEffect, useMemo, useState, useTransition } from "react";
import { suggestRoomShareSettings } from "@/lib/document-review";
import { inputClass } from "./DraftWithEarn";
import { createShare, revokeShare, updateShareAlerts } from "./materials-actions";

/** A section this room publishes, with how many documents sit in it. */
export interface PublishedSection {
  key: string;
  label: string;
  count: number;
}

export interface ShareView {
  id: string;
  token: string;
  label: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string | null;
  allowed_sections: string[] | null;
  allow_download?: boolean;
  watermark?: boolean;
  /** Set on a single-document link made from a document's review page. */
  document_id?: string | null;
  /** Email the creator the first time each reader opens the link. */
  notify_on_open?: boolean;
  /** Email the creator a daily summary of activity on the link. */
  daily_digest?: boolean;
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
          <span className={`font-mono text-[11px] uppercase tracking-wider ${live ? "text-emerald-400" : "text-fg-muted"}`}>
            {st.label}
          </span>
        </div>

        <span className="text-sm font-medium text-fg-primary">{share.label || "Untitled link"}</span>

        {[
          share.document_id ? "One document" : null,
          share.allow_download === false ? "View-only" : null,
          share.watermark ? "Watermarked" : null,
        ]
          .filter(Boolean)
          .map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted"
            >
              {tag}
            </span>
          ))}

        {share.expires_at && !share.revoked_at ? (
          <span className="font-mono text-[11px] text-fg-muted">
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
              className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20"
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
          <p className="truncate font-mono text-[11px] text-fg-muted">{url}</p>
          {/* Three states, not two. An allowlist is deny-by-default, so an
              empty array grants nothing — reading it as "no restriction" would
              tell the operator a link gives full access while it shows the
              recipient an empty room. */}
          {share.allowed_sections === null ? (
            <p className="mt-1 font-mono text-[11px] text-fg-muted/50">Everything published in this room</p>
          ) : share.allowed_sections.length === 0 ? (
            <p className="mt-1 font-mono text-[11px] text-amber-400/80">
              No sections — this link shows nothing
            </p>
          ) : (
            <p className="mt-1 font-mono text-[11px] text-fg-muted/70">
              Sections: {share.allowed_sections.join(", ")}
            </p>
          )}
          <AlertToggles share={share} />
        </div>
      ) : null}
    </div>
  );
}

/** On/off for a live link's alerts, without making a new link. */
function AlertToggles({ share }: { share: ShareView }) {
  const [notify, setNotify] = useState(Boolean(share.notify_on_open));
  const [digest, setDigest] = useState(Boolean(share.daily_digest));
  const [pending, startTransition] = useTransition();

  const flip = (which: "notify" | "digest") => {
    const next = which === "notify" ? !notify : !digest;
    if (which === "notify") setNotify(next);
    else setDigest(next);
    startTransition(async () => {
      try {
        await updateShareAlerts(share.id, which === "notify" ? { notifyOnOpen: next } : { dailyDigest: next });
      } catch {
        // Put the switch back where the server still has it.
        if (which === "notify") setNotify(!next);
        else setDigest(!next);
      }
    });
  };

  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition disabled:opacity-50 ${
      on ? "border-gold-500/50 bg-gold-500/10 text-gold-300" : "border-line text-fg-muted hover:text-fg-secondary"
    }`;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted/70">Email me</span>
      <button type="button" aria-pressed={notify} disabled={pending} onClick={() => flip("notify")} className={chip(notify)}>
        First open per reader
      </button>
      <button type="button" aria-pressed={digest} disabled={pending} onClick={() => flip("digest")} className={chip(digest)}>
        Daily digest
      </button>
    </div>
  );
}

function CreateShareForm({
  roomId,
  roomName,
  publishedSections,
  onDone,
}: {
  roomId: string;
  roomName: string;
  publishedSections: PublishedSection[];
  onDone: () => void;
}) {
  const earn = useMemo(
    () => suggestRoomShareSettings({ roomName, sections: publishedSections.map((s) => s.key) }),
    [roomName, publishedSections],
  );
  const [label, setLabel] = useState("");
  const [expiresDays, setExpiresDays] = useState("");
  const [pending, startTransition] = useTransition();
  const [requireEmail, setRequireEmail] = useState(false);
  const [requireNda, setRequireNda] = useState(false);
  const [showNdaText, setShowNdaText] = useState(false);
  const [requirePassword, setRequirePassword] = useState(false);
  const [notifyOnOpen, setNotifyOnOpen] = useState(false);
  const [dailyDigest, setDailyDigest] = useState(false);
  const applyEarn = () => {
    setLabel((v) => v || earn.label);
    setExpiresDays(String(earn.expiresInDays));
    setRequireEmail(earn.requireEmail);
    setRequireNda(earn.requireNda);
    setAllowDownload(earn.allowDownload);
    setWatermark(earn.watermark);
    setNotifyOnOpen(true);
  };
  const [allowDownload, setAllowDownload] = useState(true);
  const [watermark, setWatermark] = useState(false);
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
        // An unchecked box is absent from FormData, so turning downloads off
        // has to be said explicitly.
        fd.set("allow_download", allowDownload ? "1" : "0");
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
      <input type="hidden" name="room_id" value={roomId} />

      {/* Earn's suggestion — applied only when the operator asks. */}
      <div className="mb-3 flex items-start gap-3 rounded-lg border border-gold-500/20 bg-gold-500/5 px-3 py-2">
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-fg-secondary">
          <span className="text-gold-300">Earn suggests:</span> {earn.expiresInDays}-day link
          {earn.requireNda ? ", NDA" : earn.requireEmail ? ", email capture" : ""}
          {earn.allowDownload ? "" : ", view-only"}
          {earn.watermark ? ", watermarked" : ""}. {earn.rationale}
        </p>
        <button
          type="button"
          onClick={applyEarn}
          className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-gold-300 hover:underline"
        >
          Apply
        </button>
      </div>

      {/* Basic fields */}
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          name="label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. 'Q3 2025 raise')"
          className={inputClass}
        />
        <input
          name="expires_in_days"
          type="number"
          min={1}
          value={expiresDays}
          onChange={(e) => setExpiresDays(e.target.value)}
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
        <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-fg-muted">Access gates</p>

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
              className="ml-auto font-mono text-[11px] uppercase tracking-wider text-gold-300 hover:text-gold-300"
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
          <span className="text-sm text-fg-secondary">Email me the first time each reader opens it</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            name="daily_digest"
            value="1"
            checked={dailyDigest}
            onChange={(e) => setDailyDigest(e.target.checked)}
            className="h-3.5 w-3.5 accent-gold-400"
          />
          <span className="text-sm text-fg-secondary">Daily activity digest</span>
          <span className="ml-auto text-[11px] text-fg-muted">Only on days with activity</span>
        </label>
      </div>

      {/* View controls */}
      <div className="mt-3 space-y-2 rounded-lg border border-line bg-surface-0 p-3">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-fg-muted">Viewing</p>
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={allowDownload}
            onChange={(e) => setAllowDownload(e.target.checked)}
            className="h-3.5 w-3.5 accent-gold-400"
          />
          <span className="text-sm text-fg-secondary">Allow downloads</span>
          <span className="ml-auto text-[11px] text-fg-muted">{allowDownload ? "" : "View-only in the room"}</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            name="watermark"
            value="1"
            checked={watermark}
            onChange={(e) => setWatermark(e.target.checked)}
            className="h-3.5 w-3.5 accent-gold-400"
          />
          <span className="text-sm text-fg-secondary">Watermark PDFs with the reader&apos;s email and time</span>
        </label>
        {watermark && !requireEmail ? (
          <p className="text-[11px] text-amber-400/80">
            Turn on &quot;Require viewer email&quot; so the watermark names the reader, not just the link.
          </p>
        ) : null}
      </div>

      {/* Section scope — only what this room publishes */}
      <div className="mt-3 space-y-2 rounded-lg border border-line bg-surface-0 p-3">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-fg-muted">Scope</p>
        {publishedSections.length === 0 ? (
          <p className="text-xs text-fg-muted">
            This room publishes nothing yet — a link would open an empty room.
          </p>
        ) : (
          <>
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
                {publishedSections.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => toggleSection(s.key)}
                    className={`rounded-full border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider transition ${
                      selectedSections.has(s.key)
                        ? "border-gold-500/60 bg-gold-500/15 text-gold-300"
                        : "border-line text-fg-muted hover:border-gold-500/30 hover:text-fg-secondary"
                    }`}
                  >
                    {s.label} · {s.count}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          disabled={pending}
          className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-medium text-on-gold transition hover:bg-gold-300 disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create link"}
        </button>
        <p className="text-xs text-fg-muted">
          {limitSections && selectedSections.size > 0
            ? `${selectedSections.size} section${selectedSections.size > 1 ? "s" : ""} will be visible`
            : "Everything published in this room — anyone with the link can view"}
        </p>
      </div>
    </form>
  );
}

// Create + manage read-only public links into one room.
export function ShareControls({
  roomId,
  roomName,
  publishedSections,
  shares,
  activeCount,
}: {
  roomId: string;
  roomName: string;
  publishedSections: PublishedSection[];
  shares: ShareView[];
  activeCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const active = shares.filter((s) => !s.revoked_at);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold tracking-tight text-fg-primary">
            Share
            {activeCount ? (
              <span className="ml-2 font-mono text-[11px] uppercase tracking-wider text-emerald-400">
                {activeCount} live
              </span>
            ) : null}
          </h3>
          <p className="mt-0.5 text-sm text-fg-secondary">
            Read-only links into <span className="text-fg-primary">{roomName}</span> for LPs,
            co-investors, lenders, and partners — no account required.
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
        <CreateShareForm
          roomId={roomId}
          roomName={roomName}
          publishedSections={publishedSections}
          onDone={() => setOpen(false)}
        />
      ) : null}

      {active.length === 0 && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-xl border border-dashed border-line bg-surface-1 px-4 py-8 text-center transition hover:border-gold-500/40 hover:bg-gold-500/5"
        >
          <p className="text-sm text-fg-muted">No active links.</p>
          <p className="mt-1 text-xs text-gold-300">Click to create a shareable link →</p>
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
