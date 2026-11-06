"use client";

// The parts of the follow-up panel that make it a loop rather than a button:
// reworking the draft (tone, instruction, template, booking link), choosing
// how it goes (each reader's own next steps, later, nudge), reviewing exactly
// who gets what before it leaves, a short window to take it back, and what
// happened to it afterwards, person by person.

import { useCallback, useEffect, useRef, useState } from "react";
import { FOLLOW_UP_TONES, NUDGE_DAYS, TEMPLATE_TOKENS, type DeliveryLine, type FollowUpTone } from "@/lib/meetings/follow-up-loop";

const field =
  "min-h-8 rounded-md border border-[var(--line)] bg-[var(--surface-0)] px-2 text-xs text-[var(--fg-primary)]";
const quiet =
  "min-h-8 rounded-md border border-[var(--line)] px-2.5 text-xs text-[var(--fg-secondary,var(--fg-primary))] hover:bg-[var(--surface-2)] disabled:opacity-50";

// ─── Reworking the draft ────────────────────────────────────────────────────

export function FollowUpTools({
  meetingId,
  body,
  onBody,
  bookingUrl,
  disabled = false,
}: {
  meetingId: string;
  body: string;
  onBody: (next: string) => void;
  bookingUrl?: string | null;
  disabled?: boolean;
}) {
  const [tone, setTone] = useState<FollowUpTone>("warm");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string }> | null>(null);
  const [saving, setSaving] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const previous = useRef<string | null>(null);

  async function rewrite(payload: Record<string, unknown>, done: string) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/follow-up/rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as { body?: string; error?: string };
      if (!res.ok || !json.body) {
        setNote(json.error ?? "Couldn't rework it just now.");
        return;
      }
      previous.current = body;
      onBody(json.body);
      setNote(done);
    } catch {
      setNote("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const loadTemplates = useCallback(async () => {
    if (templates) return;
    try {
      const res = await fetch("/api/meetings/follow-up-templates");
      const json = (await res.json().catch(() => ({}))) as { templates?: Array<{ id: string; name: string }> };
      setTemplates(json.templates ?? []);
    } catch {
      setTemplates([]);
    }
  }, [templates]);

  async function saveTemplate(e: React.FormEvent) {
    e.preventDefault();
    const name = templateName.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/meetings/follow-up-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, body }),
      });
      const json = (await res.json().catch(() => ({}))) as { template?: { id: string; name: string }; error?: string };
      if (!res.ok || !json.template) {
        setNote(json.error ?? "Couldn't save the template.");
        return;
      }
      setTemplates((prev) => [...(prev ?? []), json.template!].sort((a, b) => a.name.localeCompare(b.name)));
      setSaving(false);
      setTemplateName("");
      setNote(`Saved as "${name}" for your firm.`);
    } catch {
      setNote("Couldn't save the template.");
    }
  }

  function addBookingLink() {
    if (!bookingUrl) return;
    const line = `If it helps, you can pick a time for our next conversation here: ${bookingUrl}`;
    const paragraphs = body.split(/\n{2,}/);
    const signAt = paragraphs.findIndex((p, i) => i > 0 && /^(best|thanks|thank you|regards|kind regards|warm regards|cheers|sincerely)[,.!]?\s*(\n|$)/i.test(p.trim()));
    previous.current = body;
    onBody(signAt === -1 ? `${body.trimEnd()}\n\n${line}` : [...paragraphs.slice(0, signAt), line, ...paragraphs.slice(signAt)].join("\n\n"));
    setNote("Booking link added.");
  }

  function undo() {
    if (previous.current === null) return;
    onBody(previous.current);
    previous.current = null;
    setNote(null);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-3" aria-label="Rework the follow-up" role="group">
      <div className="flex flex-wrap items-center gap-1.5">
        <select className={field} value={tone} onChange={(e) => setTone(e.target.value as FollowUpTone)} aria-label="Tone" disabled={disabled || busy}>
          {FOLLOW_UP_TONES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <input
          className={`${field} min-w-0 flex-1`}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          maxLength={300}
          placeholder="Anything else? e.g. shorter, lead with the term sheet"
          aria-label="Rewrite instruction"
          disabled={disabled || busy}
        />
        <button type="button" className={quiet} disabled={disabled || busy || !body.trim()} onClick={() => rewrite({ body, tone, instruction }, "Rewritten — read it before sending.")}>
          {busy ? "Rewriting…" : "Rewrite"}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          className={field}
          defaultValue=""
          onFocus={loadTemplates}
          onMouseDown={loadTemplates}
          onChange={(e) => {
            const id = e.target.value;
            e.target.value = "";
            if (id) void rewrite({ templateId: id }, "Template applied — read it before sending.");
          }}
          aria-label="Use a template"
          disabled={disabled || busy}
        >
          <option value="">Use a template…</option>
          {(templates ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          {templates && templates.length === 0 && <option disabled>No templates yet</option>}
        </select>
        {!saving ? (
          <button type="button" className={quiet} onClick={() => setSaving(true)} disabled={disabled || !body.trim()}>
            Save as template
          </button>
        ) : (
          <form onSubmit={saveTemplate} className="flex items-center gap-1.5">
            <input className={field} value={templateName} onChange={(e) => setTemplateName(e.target.value)} maxLength={80} placeholder="Template name" aria-label="Template name" autoFocus />
            <button type="submit" className={quiet}>
              Save
            </button>
            <button type="button" className={quiet} onClick={() => setSaving(false)}>
              Cancel
            </button>
          </form>
        )}
        {bookingUrl && (
          <button type="button" className={quiet} onClick={addBookingLink} disabled={disabled}>
            Add booking link
          </button>
        )}
        {previous.current !== null && (
          <button type="button" className={quiet} onClick={undo}>
            Undo change
          </button>
        )}
      </div>
      {saving && (
        <p className="text-[11px] text-[var(--fg-muted)]">
          Templates can use {TEMPLATE_TOKENS.map((t) => t.token).join(", ")} — filled in from each meeting&apos;s report.
        </p>
      )}
      {note && (
        <p className="text-[11px] text-[var(--fg-muted)]" aria-live="polite">
          {note}
        </p>
      )}
    </div>
  );
}

// ─── How it goes ────────────────────────────────────────────────────────────

export interface SendOptions {
  personalItems: boolean;
  nudgeAfterDays: number | null;
  /** A local "YYYY-MM-DDTHH:mm" from the picker, or "" for now. */
  later: string;
}

export const DEFAULT_SEND_OPTIONS: SendOptions = { personalItems: true, nudgeAfterDays: null, later: "" };

export function SendOptionsRow({ value, onChange, disabled = false }: { value: SendOptions; onChange: (next: SendOptions) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--fg-muted)]">
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={value.personalItems} onChange={(e) => onChange({ ...value, personalItems: e.target.checked })} disabled={disabled} />
        Give each person their own next steps
      </label>
      <label className="flex items-center gap-1.5">
        Nudge if no reply
        <select
          className={field}
          value={value.nudgeAfterDays ?? ""}
          onChange={(e) => onChange({ ...value, nudgeAfterDays: e.target.value ? Number(e.target.value) : null })}
          aria-label="Nudge if no reply"
          disabled={disabled}
        >
          <option value="">Off</option>
          {NUDGE_DAYS.map((d) => (
            <option key={d} value={d}>
              after {d} days
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        Send
        <select
          className={field}
          value={value.later ? "later" : "now"}
          onChange={(e) => onChange({ ...value, later: e.target.value === "later" ? defaultLater() : "" })}
          aria-label="When to send"
          disabled={disabled}
        >
          <option value="now">Now</option>
          <option value="later">Later…</option>
        </select>
        {value.later && (
          <input
            type="datetime-local"
            className={field}
            value={value.later}
            min={localInput(new Date(Date.now() + 10 * 60_000))}
            onChange={(e) => onChange({ ...value, later: e.target.value })}
            aria-label="Send at"
            disabled={disabled}
          />
        )}
      </label>
    </div>
  );
}

function localInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Tomorrow at 9am, local: the time most people mean by "later". */
function defaultLater(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return localInput(d);
}

/** The picker's local time as an ISO instant, or null for "now". */
export function sendAtIso(later: string): string | null {
  if (!later) return null;
  const at = new Date(later);
  return Number.isFinite(at.getTime()) ? at.toISOString() : null;
}

// ─── Review, then a moment to take it back ──────────────────────────────────

export interface ReviewRecipient {
  name: string;
  email: string | null;
  external: boolean;
  /** How many next steps of their own this person's copy carries. */
  ownSteps: number;
}

export function ReviewBeforeSend({
  recipients,
  options,
  onConfirm,
  onCancel,
}: {
  recipients: readonly ReviewRecipient[];
  options: SendOptions;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const external = recipients.filter((r) => r.external);
  const at = sendAtIso(options.later);
  return (
    <div role="region" aria-label="Review before sending" className="flex flex-col gap-3 rounded-lg border border-[var(--gold-400)]/40 bg-[var(--gold-400)]/5 p-3">
      <p className="text-xs font-medium text-[var(--fg-primary)]">
        {at
          ? `This will go to ${recipients.length} ${recipients.length === 1 ? "person" : "people"} on ${new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`
          : `This goes to ${recipients.length} ${recipients.length === 1 ? "person" : "people"} now, from your mailbox.`}
        {options.nudgeAfterDays ? ` Anyone who hasn't replied after ${options.nudgeAfterDays} days gets a short nudge.` : ""}
      </p>
      <ul className="flex flex-col gap-1 text-xs">
        {recipients.map((r) => (
          <li key={r.email ?? r.name} className="flex flex-wrap items-center gap-2">
            <span className="text-[var(--fg-primary)]">{r.name}</span>
            <span className="text-[var(--fg-muted)]">{r.email}</span>
            {r.external && (
              <span className="rounded-full bg-[var(--status-warning,#f59e0b)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--status-warning,#f59e0b)]">External</span>
            )}
            {options.personalItems && r.ownSteps > 0 && (
              <span className="text-[10px] text-[var(--fg-muted)]">
                + {r.ownSteps} next {r.ownSteps === 1 ? "step" : "steps"} of their own
              </span>
            )}
          </li>
        ))}
      </ul>
      {external.length > 0 && (
        <p className="text-xs text-[var(--status-warning,#f59e0b)]">
          {external.length === 1 ? `${external[0].name} is` : `${external.length} people are`} outside your firm. Check nothing internal is in the email.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onConfirm} className="min-h-8 rounded-lg bg-[var(--gold-400)] px-3 text-xs font-semibold text-[#0d0d10]">
          {at ? "Schedule it" : "Confirm and send"}
        </button>
        <button type="button" onClick={onCancel} className={quiet}>
          Back
        </button>
      </div>
    </div>
  );
}

/** "Sending in 8s — Undo": nothing leaves until it reaches zero. */
export function UndoCountdown({ seconds, onUndo, onDone }: { seconds: number; onUndo: () => void; onDone: () => void }) {
  const [left, setLeft] = useState(seconds);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (left <= 0) {
      done.current();
      return;
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  if (left <= 0) return null;
  return (
    <div role="status" className="flex items-center gap-3 text-xs text-[var(--fg-primary)]">
      Sending in {left}s
      <button type="button" onClick={onUndo} className="min-h-8 rounded-md border border-[var(--line)] px-3 font-semibold">
        Undo
      </button>
    </div>
  );
}

// ─── What happened to it ────────────────────────────────────────────────────

const STATE_LABEL: Record<DeliveryLine["state"], string> = {
  scheduled: "Scheduled",
  sent: "Sent",
  failed: "Failed",
  cancelled: "Cancelled",
  replied: "Replied",
  nudged: "Nudged",
};

const STATE_TONE: Record<DeliveryLine["state"], string> = {
  scheduled: "bg-[var(--gold-400)]/15 text-[var(--gold-400)]",
  sent: "bg-[var(--surface-3)] text-[var(--fg-secondary,var(--fg-primary))]",
  failed: "bg-[var(--status-danger,#ef4444)]/15 text-[var(--status-danger,#ef4444)]",
  cancelled: "bg-[var(--surface-3)] text-[var(--fg-muted)]",
  replied: "bg-[var(--status-success)]/15 text-[var(--status-success)]",
  nudged: "bg-[var(--gold-400)]/15 text-[var(--gold-400)]",
};

export function DeliveryList({
  meetingId,
  version,
  onRetry,
  onBookingUrl,
  onHostEmail,
}: {
  meetingId: string;
  /** Bumped after a send, to read the list again. */
  version: number;
  onRetry: (emails: string[]) => void;
  onBookingUrl?: (url: string | null) => void;
  onHostEmail?: (email: string | null) => void;
}) {
  const [lines, setLines] = useState<DeliveryLine[]>([]);
  const [busy, setBusy] = useState(false);
  const callbacks = useRef({ onBookingUrl, onHostEmail });
  callbacks.current = { onBookingUrl, onHostEmail };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/meetings/${meetingId}/follow-up/status`, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { lines?: DeliveryLine[]; bookingUrl?: string | null; hostEmail?: string | null };
      setLines(json.lines ?? []);
      callbacks.current.onBookingUrl?.(json.bookingUrl ?? null);
      callbacks.current.onHostEmail?.(json.hostEmail ?? null);
    } catch {
      // The list stays as it was.
    }
  }, [meetingId]);

  useEffect(() => {
    void load();
  }, [load, version]);

  async function cancelScheduled(ids?: string[]) {
    setBusy(true);
    try {
      await fetch(`/api/meetings/${meetingId}/follow-up/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids ? { ids } : {}),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!lines.length) return null;
  const failed = lines.filter((l) => l.state === "failed");
  const scheduled = lines.filter((l) => l.state === "scheduled");

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-3" aria-label="Delivery" role="region">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-muted)]">Delivery</h3>
        <div className="flex gap-1.5">
          {failed.length > 0 && (
            <button type="button" className={quiet} onClick={() => onRetry(failed.map((l) => l.email))}>
              Retry {failed.length} failed
            </button>
          )}
          {scheduled.length > 0 && (
            <button type="button" className={quiet} disabled={busy} onClick={() => cancelScheduled()}>
              Cancel scheduled
            </button>
          )}
        </div>
      </div>
      <ul className="flex flex-col gap-1.5">
        {lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-2 text-xs" data-delivery={l.state}>
            <span className="min-w-0 truncate text-[var(--fg-primary)]">{l.name ?? l.email}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATE_TONE[l.state]}`}>{STATE_LABEL[l.state]}</span>
            {l.at && (
              <span className="text-[var(--fg-muted)]">
                {new Date(l.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
            )}
            {l.state === "sent" && l.nudgeAfterDays ? <span className="text-[var(--fg-muted)]">· nudge after {l.nudgeAfterDays} days</span> : null}
            {l.error && <span className="text-[var(--status-danger,#ef4444)]">· {l.error}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
