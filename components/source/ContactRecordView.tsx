"use client";

// The contact record — the CRM surface Network OS was missing.
//
// Left column: the relationship timeline (what actually happened, hand-logged
// and system-written) with the composer that writes to it. Right column: the
// state an operator changes — stage, owner, visibility, tags — plus open
// follow-ups, compliance standing, and any duplicate that should be merged.
//
// Every control writes through an API route that also records the change on the
// timeline and in the audit log, so nothing here changes quietly.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CONTACT_STAGES, STAGE_LABEL, type ContactStage } from "@/lib/network-stages";
import { LOGGABLE_TYPES } from "@/lib/network-contact";
import { reportUrlFromMetadata } from "@/lib/meetings/crm-activity";
import { identityIsAsserted } from "@/lib/crm/identity-assurance";
import { ContactReportMenu } from "@/components/source/ContactReportMenu";
import type {
  ContactRecordView as RecordView,
  ContactRecord,
  ContactTask,
  NetworkActivityKind,
  TimelineEntry,
} from "@/lib/network-contact";

const TYPE_LABEL: Record<string, string> = {
  note: "Note",
  call: "Call",
  meeting: "Meeting",
  email: "Email",
  linkedin: "LinkedIn",
  intro: "Introduction",
  document: "Document",
  other: "Other",
  stage_change: "Stage change",
  owner_change: "Owner change",
  task: "Follow-up",
  commitment: "Commitment",
  import: "Import",
  merge: "Merge",
};

const COMMS_TONE: Record<string, string> = {
  allowed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  unsubscribed: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  do_not_contact: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  blocked: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  bounced: "border-gold-500/30 bg-gold-500/10 text-gold-300",
};

function initials(name: string): string {
  return name.split(/\s+/).map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The inbox thread a timeline entry describes, when it describes one. */
function threadIdFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as { thread_id?: unknown }).thread_id;
  return typeof raw === "string" && raw ? raw : null;
}

function humanize(v: string): string {
  return v.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

interface Props {
  initial: RecordView;
  owners: { id: string; name: string }[];
  currentUserId: string;
  canDelete: boolean;
  /**
   * Whether this viewer may correct a machine-written entry — the org-admin
   * right flag_network_activity_misattributed checks for itself. It also
   * governs whether corrected entries were LOADED at all, so a false here means
   * `entries` contains none and there is nothing to reveal.
   */
  canCorrect: boolean;
}

export function ContactRecordView({ initial, owners, currentUserId, canCorrect }: Props) {
  const [contact, setContact] = useState<ContactRecord>(initial.contact);
  const [timeline, setTimeline] = useState<TimelineEntry[]>(initial.timeline);
  const [tasks, setTasks] = useState<ContactTask[]>(initial.tasks);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const router = useRouter();

  /**
   * Take the server's word when it re-reads the record.
   *
   * useState only reads its argument on mount, so new `initial` props are
   * ignored afterwards. That was harmless while every mutation here patched
   * local state — the component was the only writer, and it was self-consistent.
   * The correction broke that: it deliberately does NOT patch, because the RPC
   * also recomputes the contact's last_activity_at, and calls router.refresh()
   * so the server recomputes the whole record. Without this the refresh changed
   * nothing a person could see — the corrected entry stayed on the timeline and
   * the header kept the recency the database had just moved. CodeRabbit caught
   * it; my own test had asserted only that refresh was CALLED, which is a claim
   * about my assumption rather than about what a reader ends up looking at.
   */
  useEffect(() => {
    setContact(initial.contact);
  }, [initial.contact]);

  useEffect(() => {
    setTimeline(initial.timeline);
  }, [initial.timeline]);

  /**
   * Mark an automatic entry as being about the wrong person, or put it back.
   *
   * Refreshes the server component rather than patching the row in state. The
   * RPC does two things: it marks the row AND recomputes the contact's
   * last_activity_at from the entries that remain. Patching one entry would
   * leave the header showing a recency the database no longer agrees with —
   * the same half-a-fix the function exists to avoid.
   */
  const correctEntry = useCallback(
    async (entryId: string, misattributed: boolean, reason: string | null): Promise<boolean> => {
      try {
        const res = await fetch(`/api/network/activities/${entryId}/correction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Sent explicitly in both directions. The route requires a boolean and
          // has no default, so an omitted field is a 400 rather than a restore.
          body: JSON.stringify({ misattributed, reason }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Couldn't update that entry.");
        }
        setMessage({
          tone: "ok",
          text: misattributed
            ? "Entry marked as the wrong person. It is kept as evidence and hidden from the record."
            : "Entry restored to the record.",
        });
        router.refresh();
        return true;
      } catch (err) {
        setMessage({
          tone: "error",
          text: err instanceof Error ? err.message : "Couldn't update that entry.",
        });
        // Reported rather than thrown, so the caller can keep the prompt open
        // with what the person typed still in it. Swallowing the failure AND
        // closing the form made a failed correction look like a finished one and
        // threw away the reason they had just written.
        return false;
      }
    },
    [router],
  );

  const openTasks = useMemo(() => tasks.filter((t) => t.status === "open"), [tasks]);

  const patchContact = useCallback(
    async (patch: Record<string, unknown>, describe: string) => {
      setSaving(true);
      try {
        const res = await fetch(`/api/network/contacts/${contact.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const body = (await res.json().catch(() => null)) as { contact?: ContactRecord; error?: string } | null;
        if (!res.ok || !body?.contact) throw new Error(body?.error ?? "Update failed");
        setContact(body.contact);
        setMessage({ tone: "ok", text: describe });
      } catch (err) {
        setMessage({ tone: "error", text: err instanceof Error ? err.message : "Update failed" });
      } finally {
        setSaving(false);
      }
    },
    [contact.id],
  );

  const logActivity = useCallback(
    async (entry: { type: NetworkActivityKind; subject: string; body: string; occurredAt: string }) => {
      const res = await fetch(`/api/network/contacts/${contact.id}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      const body = (await res.json().catch(() => null)) as { entry?: TimelineEntry; error?: string } | null;
      if (!res.ok || !body?.entry) throw new Error(body?.error ?? "Couldn't log that.");
      setTimeline((prev) =>
        [body.entry as TimelineEntry, ...prev].sort(
          (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
        ),
      );
      setContact((c) => ({ ...c, lastActivityAt: body.entry!.occurredAt }));
    },
    [contact.id],
  );

  const addTask = useCallback(
    async (input: { title: string; dueAt: string | null; priority: string }) => {
      const res = await fetch("/api/network/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: contact.id, ...input }),
      });
      const body = (await res.json().catch(() => null)) as { task?: ContactTask; error?: string } | null;
      if (!res.ok || !body?.task) throw new Error(body?.error ?? "Couldn't create that follow-up.");
      setTasks((prev) => [body.task as ContactTask, ...prev]);
    },
    [contact.id],
  );

  const setTaskStatus = useCallback(async (task: ContactTask, status: "open" | "done") => {
    const before = task.status;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status } : t)));
    try {
      const res = await fetch(`/api/network/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: before } : t)));
      setMessage({ tone: "error", text: "Couldn't update that follow-up." });
    }
  }, []);

  const commsTone = COMMS_TONE[contact.communicationStatus] ?? "border-line bg-surface-2 text-fg-secondary";
  const contactable = contact.communicationStatus === "allowed";

  return (
    <div className="flex flex-col gap-6">
      {/* Identity header */}
      <header className="fx-card flex flex-wrap items-start gap-4 p-5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-base font-semibold text-fg-secondary">
          {initials(contact.fullName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-fg-primary">
              {contact.fullName}
            </h1>
            {contact.verified && (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-px text-[11px] text-emerald-300">
                Verified
              </span>
            )}
            {contact.visibility === "private" && (
              <span className="rounded-full border border-line bg-surface-2 px-2 py-px text-[11px] text-fg-muted">
                Private
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-fg-secondary">
            {[contact.title, contact.company].filter(Boolean).join(" · ") || "No title on file"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="transition hover:text-fg-primary">
                {contact.email}
              </a>
            )}
            {contact.phone && <span>{contact.phone}</span>}
            {contact.location && <span>{contact.location}</span>}
            {contact.linkedinUrl && (
              <a
                href={contact.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="transition hover:text-fg-primary"
              >
                LinkedIn
              </a>
            )}
          </div>
          {contact.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {contact.tags.map((t) => (
                <span key={t} className="rounded-full border border-line bg-surface-2 px-2 py-px text-[11px] text-fg-muted">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">Warmth</span>
          <span className="font-display text-2xl font-semibold tabular-nums text-fg-primary">
            {contact.strengthScore}
          </span>
          <span className="text-[11px] text-fg-muted">{humanize(contact.strengthLabel)}</span>
          <div className="mt-2">
            <ContactReportMenu contactId={contact.id} />
          </div>
        </div>
      </header>

      {/* Compliance standing — before anyone drafts anything. */}
      {(!contactable || contact.complianceFlags.length > 0) && (
        <div className={`rounded-xl border px-4 py-2.5 text-xs ${commsTone}`}>
          <span className="font-medium">{humanize(contact.communicationStatus)}</span>
          {!contactable && " — outbound to this contact is blocked."}
          {contact.complianceFlags.length > 0 && ` Flags: ${contact.complianceFlags.join(", ")}.`}
        </div>
      )}

      {message && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            message.tone === "error"
              ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
              : "border-line bg-surface-1 text-fg-secondary"
          }`}
        >
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-auto text-fg-muted hover:text-fg-primary">
            ×
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* Timeline */}
        <section className="flex flex-col gap-4">
          <ActivityComposer onLog={logActivity} onError={(t) => setMessage({ tone: "error", text: t })} />
          <Timeline entries={timeline} canCorrect={canCorrect} onCorrect={correctEntry} />
        </section>

        {/* Relationship state */}
        <aside className="flex flex-col gap-4">
          <div className="fx-card flex flex-col gap-3 p-4">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">Relationship</h2>

            <Field label="Stage">
              <select
                value={contact.stage}
                disabled={saving}
                onChange={(e) =>
                  patchContact({ stage: e.target.value }, `Moved to ${STAGE_LABEL[e.target.value as ContactStage]}.`)
                }
                className="fx-focus w-full rounded-md border border-line bg-surface-1 px-2 py-1 text-xs text-fg-primary disabled:opacity-50"
              >
                {CONTACT_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Owner">
              <select
                value={contact.ownerId ?? ""}
                disabled={saving}
                onChange={(e) =>
                  patchContact(
                    { ownerId: e.target.value || null },
                    e.target.value ? "Relationship reassigned." : "Relationship unassigned.",
                  )
                }
                className="fx-focus w-full rounded-md border border-line bg-surface-1 px-2 py-1 text-xs text-fg-primary disabled:opacity-50"
              >
                <option value="">Unassigned</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                    {o.id === currentUserId ? " (you)" : ""}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Visibility">
              <select
                value={contact.visibility}
                disabled={saving}
                onChange={(e) =>
                  patchContact(
                    { visibility: e.target.value },
                    e.target.value === "private"
                      ? "Now private to you and org admins."
                      : "Now pooled to the whole organization.",
                  )
                }
                className="fx-focus w-full rounded-md border border-line bg-surface-1 px-2 py-1 text-xs text-fg-primary disabled:opacity-50"
              >
                <option value="org">Shared with the organization</option>
                <option value="private">Private to me</option>
              </select>
            </Field>

            <dl className="mt-1 flex flex-col gap-1.5 border-t border-line pt-3 text-xs">
              <Row label="Capital role" value={contact.capitalRole ? humanize(contact.capitalRole) : "—"} />
              <Row label="Last activity" value={formatDate(contact.lastActivityAt)} />
              <Row label="Connected" value={formatDate(contact.connectedOn ?? contact.addedAt)} />
              <Row label="Source" value={contact.source ? humanize(contact.source) : "—"} />
              <Row label="Consent basis" value={contact.consentBasis ? humanize(contact.consentBasis) : "—"} />
            </dl>
          </div>

          <TaskPanel
            tasks={tasks}
            openTasks={openTasks}
            onAdd={addTask}
            onToggle={setTaskStatus}
            onError={(t) => setMessage({ tone: "error", text: t })}
          />

          {initial.possibleDuplicates.length > 0 && (
            <div className="fx-card flex flex-col gap-2 p-4">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                Possible duplicates
              </h2>
              <p className="text-xs text-fg-muted">
                These look like the same person. Merging keeps this record and moves their history onto it.
              </p>
              {initial.possibleDuplicates.map((d) => (
                <MergeRow key={d.id} duplicate={d} targetId={contact.id} />
              ))}
            </div>
          )}

          {contact.notes && (
            <div className="fx-card flex flex-col gap-2 p-4">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">Notes</h2>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-fg-secondary">{contact.notes}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="truncate text-right text-fg-secondary">{value}</dd>
    </div>
  );
}

function ActivityComposer({
  onLog,
  onError,
}: {
  onLog: (e: { type: NetworkActivityKind; subject: string; body: string; occurredAt: string }) => Promise<void>;
  onError: (text: string) => void;
}) {
  const [type, setType] = useState<NetworkActivityKind>("note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!subject.trim() && !body.trim()) {
      onError("Add a subject or some detail to log.");
      return;
    }
    setBusy(true);
    try {
      await onLog({
        type,
        subject: subject.trim(),
        body: body.trim(),
        // A blank date means "now"; a set one back-dates the entry.
        occurredAt: when ? new Date(when).toISOString() : new Date().toISOString(),
      });
      setSubject("");
      setBody("");
      setWhen("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't log that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fx-card flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as NetworkActivityKind)}
          className="fx-focus rounded-md border border-line bg-surface-1 px-2 py-1 text-xs text-fg-primary"
        >
          {LOGGABLE_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t] ?? t}
            </option>
          ))}
        </select>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject — what happened?"
          className="fx-focus min-w-[160px] flex-1 rounded-md border border-line bg-surface-1 px-2 py-1 text-xs text-fg-primary placeholder:text-fg-muted"
        />
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          title="When it happened — leave blank for now"
          className="fx-focus rounded-md border border-line bg-surface-1 px-2 py-1 text-xs text-fg-muted"
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Detail — what was said, what was agreed, what comes next."
        className="fx-focus w-full rounded-md border border-line bg-surface-1 px-2 py-1.5 text-xs leading-relaxed text-fg-primary placeholder:text-fg-muted"
      />
      <div className="flex items-center justify-end">
        <button onClick={submit} disabled={busy} className="fx-btn-secondary text-xs disabled:opacity-50">
          {busy ? "Logging…" : "Log activity"}
        </button>
      </div>
    </div>
  );
}

function Timeline({
  entries,
  canCorrect,
  onCorrect,
}: {
  entries: TimelineEntry[];
  canCorrect: boolean;
  onCorrect: (entryId: string, misattributed: boolean, reason: string | null) => Promise<boolean>;
}) {
  const [showCorrected, setShowCorrected] = useState(false);

  const corrected = useMemo(() => entries.filter((e) => e.misattributedAt !== null), [entries]);
  const visible = useMemo(
    () => (showCorrected ? entries : entries.filter((e) => e.misattributedAt === null)),
    [entries, showCorrected],
  );

  // Never reached by a member: the loader does not return corrected rows unless
  // the caller may correct them, so `corrected` is empty and this renders
  // nothing. The canCorrect check is belt and braces on top of that.
  const toggle =
    canCorrect && corrected.length > 0 ? (
      <button
        type="button"
        onClick={() => setShowCorrected((v) => !v)}
        className="mb-3 text-[11px] text-fg-muted underline-offset-2 transition hover:text-fg-primary hover:underline"
      >
        {showCorrected
          ? "Hide corrected entries"
          : `Show ${corrected.length} corrected ${corrected.length === 1 ? "entry" : "entries"}`}
      </button>
    ) : null;

  if (visible.length === 0) {
    return (
      <div>
        {toggle}
        <div className="fx-card p-8 text-center">
        <p className="text-sm font-medium text-fg-primary">Nothing logged yet</p>
        <p className="mx-auto mt-2 max-w-sm text-xs text-fg-muted">
          Log the first call, meeting, or note above. From then on this is the relationship&apos;s record —
          what happened, when, and who was there.
        </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {toggle}
      <ol className="flex flex-col">
      {visible.map((e, i) => (
        <li
          key={e.id}
          className={`relative flex gap-3 pb-4 pl-1 ${e.misattributedAt ? "opacity-55" : ""}`}
        >
          <div className="flex flex-col items-center">
            <span
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                e.misattributedAt ? "bg-fg-muted/30" : e.isSystem ? "bg-fg-muted/50" : "bg-gold-400"
              }`}
            />
            {i < visible.length - 1 && <span className="mt-1 w-px flex-1 bg-line" />}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
                {TYPE_LABEL[e.type] ?? e.type}
              </span>
              <span className="text-[11px] text-fg-muted/70">{formatDateTime(e.occurredAt)}</span>
              {e.actorName && <span className="text-[11px] text-fg-muted/70">· {e.actorName}</span>}
              {/*
                Said, not just shaded. A system entry already had a muted dot
                rather than a gold one, which tells a reader nothing on its own —
                and the difference between what this app observed and what a
                person claims happened is the whole reason is_system exists.
              */}
              {e.isSystem && (
                <span
                  className="rounded border border-line px-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted/70"
                  title="Recorded by the app, not logged by a person."
                >
                  Automatic
                </span>
              )}
              {/*
                "Automatic" says the app wrote the row. It does not say the app
                had grounds to believe this is the right person, and for an
                inbound conversation it does not: the address comes from the
                message's own From header, which the sender wrote. Saying so is
                the honest part; see lib/crm/identity-assurance.ts for why it
                cannot be more than said.
              */}
              {identityIsAsserted(e.metadata) && (
                <span
                  className="rounded border border-line px-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted/70"
                  title="Matched on an address the sender supplied. The delivery is verified; the sender's identity is not."
                >
                  Sender unverified
                </span>
              )}
              {e.misattributedAt && (
                <span
                  className="rounded border border-line px-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted/70"
                  title="Established as being about the wrong person. The entry is kept as evidence and hidden from this record."
                >
                  Corrected
                </span>
              )}
            </div>
            {e.subject && <p className="mt-0.5 text-sm text-fg-primary">{e.subject}</p>}
            {e.body && (
              <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-fg-secondary">{e.body}</p>
            )}
            {reportUrlFromMetadata(e.metadata) && (
              <a
                href={reportUrlFromMetadata(e.metadata) as string}
                className="mt-1 inline-block text-[11px] text-gold-400 hover:underline"
              >
                Open the full report →
              </a>
            )}
            {threadIdFromMetadata(e.metadata) && e.subject && (
              <Link
                href={`/inbox?q=${encodeURIComponent(e.subject)}`}
                className="mt-1 inline-block text-[11px] text-gold-400 hover:underline"
              >
                Open in inbox →
              </Link>
            )}
            {e.misattributedAt && (
              <p className="mt-1 text-[11px] text-fg-muted">
                Marked as the wrong person
                {e.misattributedByName ? ` by ${e.misattributedByName}` : ""}
                {e.misattributionReason ? ` — ${e.misattributionReason}` : ""}
              </p>
            )}
            {/*
              Offered on SYSTEM entries only. A hand-written note has an owner
              and ordinary edit and delete rights, and the function refuses it
              with 22023 — so offering this there would be a control whose only
              possible outcome is an error.
            */}
            {canCorrect && e.isSystem && (
              <CorrectionControl
                entry={e}
                onCorrect={onCorrect}
              />
            )}
          </div>
        </li>
      ))}
      </ol>
    </div>
  );
}

/**
 * The control that takes a machine-written entry off the wrong record, and the
 * one that puts it back.
 *
 * Marking asks for a reason first. The reason is what makes the correction
 * reviewable later — an entry hidden with no stated cause is indistinguishable
 * from one hidden by mistake — but it is optional, because refusing to accept a
 * correction without one would leave the wrong entry on the record.
 */
function CorrectionControl({
  entry,
  onCorrect,
}: {
  entry: TimelineEntry;
  onCorrect: (entryId: string, misattributed: boolean, reason: string | null) => Promise<boolean>;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(misattributed: boolean, why: string | null) {
    setBusy(true);
    try {
      // Only on success. A failed request leaves the prompt open with the
      // reason intact, so the person can retry rather than retype.
      if (await onCorrect(entry.id, misattributed, why)) {
        setAsking(false);
        setReason("");
      }
    } finally {
      setBusy(false);
    }
  }

  if (entry.misattributedAt) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => run(false, null)}
        className="mt-1 text-[11px] text-fg-muted underline-offset-2 transition hover:text-fg-primary hover:underline disabled:opacity-50"
      >
        {busy ? "Restoring…" : "Restore to the record"}
      </button>
    );
  }

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="mt-1 text-[11px] text-fg-muted underline-offset-2 transition hover:text-fg-primary hover:underline"
      >
        Wrong person?
      </button>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <label className="text-[11px] text-fg-muted" htmlFor={`why-${entry.id}`}>
        Why is this the wrong person? (optional)
      </label>
      <input
        id={`why-${entry.id}`}
        value={reason}
        onChange={(ev) => setReason(ev.target.value)}
        maxLength={500}
        placeholder="A colleague's address was on the invite"
        className="fx-input text-xs"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => run(true, reason.trim() || null)}
          className="fx-btn-secondary px-2 py-1 text-[11px] disabled:opacity-50"
        >
          {busy ? "Marking…" : "Take it off this record"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setAsking(false);
            setReason("");
          }}
          className="text-[11px] text-fg-muted transition hover:text-fg-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function TaskPanel({
  tasks,
  openTasks,
  onAdd,
  onToggle,
  onError,
}: {
  tasks: ContactTask[];
  openTasks: ContactTask[];
  onAdd: (t: { title: string; dueAt: string | null; priority: string }) => Promise<void>;
  onToggle: (t: ContactTask, status: "open" | "done") => void;
  onError: (text: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const done = tasks.filter((t) => t.status === "done");
  const now = Date.now();

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onAdd({
        title: title.trim(),
        dueAt: due ? new Date(due).toISOString() : null,
        priority: "normal",
      });
      setTitle("");
      setDue("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't create that follow-up.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fx-card flex flex-col gap-3 p-4">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
        Follow-ups {openTasks.length > 0 && <span className="text-gold-300">({openTasks.length})</span>}
      </h2>

      <div className="flex flex-col gap-1.5">
        {openTasks.length === 0 && <p className="text-xs text-fg-muted">Nothing owed right now.</p>}
        {openTasks.map((t) => {
          const overdue = t.dueAt ? Date.parse(t.dueAt) < now : false;
          return (
            <label key={t.id} className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={false}
                onChange={() => onToggle(t, "done")}
                className="fx-focus mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-line accent-gold-400"
              />
              <span className="min-w-0 flex-1">
                <span className="text-fg-primary">{t.title}</span>
                {t.dueAt && (
                  <span className={`ml-1.5 ${overdue ? "text-rose-300" : "text-fg-muted"}`}>
                    {overdue ? "overdue · " : "due "}
                    {formatDate(t.dueAt)}
                  </span>
                )}
                {t.assigneeName && <span className="ml-1.5 text-fg-muted/70">· {t.assigneeName}</span>}
              </span>
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          placeholder="Add a follow-up…"
          className="fx-focus min-w-[120px] flex-1 rounded-md border border-line bg-surface-1 px-2 py-1 text-xs text-fg-primary placeholder:text-fg-muted"
        />
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          title="Due date"
          className="fx-focus rounded-md border border-line bg-surface-1 px-2 py-1 text-xs text-fg-muted"
        />
        <button
          onClick={submit}
          disabled={busy || !title.trim()}
          className="fx-btn-secondary text-xs disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {done.length > 0 && (
        <div className="border-t border-line pt-2">
          <button
            onClick={() => setShowDone((s) => !s)}
            className="text-[11px] text-fg-muted transition hover:text-fg-primary"
          >
            {showDone ? "Hide" : "Show"} {done.length} completed
          </button>
          {showDone && (
            <div className="mt-1.5 flex flex-col gap-1">
              {done.map((t) => (
                <label key={t.id} className="flex items-start gap-2 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked
                    onChange={() => onToggle(t, "open")}
                    className="fx-focus mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-line accent-gold-400"
                  />
                  <span className="line-through">{t.title}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MergeRow({
  duplicate,
  targetId,
}: {
  duplicate: { id: string; fullName: string; company: string | null; email: string | null };
  targetId: string;
}) {
  const [state, setState] = useState<"idle" | "confirm" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const merge = async () => {
    setState("busy");
    try {
      const res = await fetch("/api/network/contacts/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepId: targetId, mergeId: duplicate.id }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Merge failed");
      setState("done");
      // The merged history is now on this record; reload to show it.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed");
      setState("error");
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-1 px-3 py-2 text-xs">
      <div className="min-w-0 flex-1">
        <Link href={`/network/${duplicate.id}`} className="truncate text-fg-primary hover:underline">
          {duplicate.fullName}
        </Link>
        <p className="truncate text-[11px] text-fg-muted">
          {[duplicate.company, duplicate.email].filter(Boolean).join(" · ") || "No other details"}
        </p>
        {error && <p className="mt-0.5 text-[11px] text-rose-300">{error}</p>}
      </div>
      {state === "confirm" ? (
        <>
          <button onClick={merge} className="text-[11px] font-medium text-rose-300 hover:text-rose-200">
            Confirm
          </button>
          <button onClick={() => setState("idle")} className="text-[11px] text-fg-muted hover:text-fg-primary">
            Cancel
          </button>
        </>
      ) : (
        <button
          onClick={() => setState("confirm")}
          disabled={state === "busy" || state === "done"}
          className="shrink-0 text-[11px] text-fg-muted transition hover:text-fg-primary disabled:opacity-50"
        >
          {state === "busy" ? "Merging…" : "Merge"}
        </button>
      )}
    </div>
  );
}
