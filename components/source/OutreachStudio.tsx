"use client";

import { useEffect, useRef, useState } from "react";
import {
  listOutreachSequences,
  createOutreachSequence,
  enrollOutreachTarget,
  listOutreachEnrollments,
  advanceOutreachEnrollment,
  deleteOutreachSequenceAction,
  clearOutreachSequencesAction,
} from "@/app/(app)/[hub]/[module]/outreach-actions";
// Engine code is imported as TYPES ONLY so this client bundle never pulls the
// server-side persistence layer (lib/outreach is DB-aware).
import type {
  SequenceWithSteps,
  EnrollmentWithProgress,
  SequenceTemplate,
} from "@/lib/outreach";

// Templates surfaced as build-from chips. Kept as a local literal so the client
// bundle never value-imports DEFAULT_SEQUENCES (which lives in the engine). The
// keys match lib/outreach DEFAULT_SEQUENCES; createOutreachSequence resolves the
// real steps server-side from the templateKey.
const TEMPLATES: Pick<SequenceTemplate, "key" | "name" | "channel" | "audience" | "description">[] = [
  {
    key: "lp_warm_intro",
    name: "LP warm intro — 3 touch",
    channel: "email",
    audience: "Allocators / LPs that fit the raise",
    description: "Intro, value follow-up, soft close.",
  },
  {
    key: "deal_owner_outreach",
    name: "Deal owner outreach — 4 touch",
    channel: "email",
    audience: "Founders / owners of on-thesis targets",
    description: "Off-market acquisition outreach.",
  },
  {
    key: "linkedin_light",
    name: "LinkedIn light touch — 2 step",
    channel: "linkedin",
    audience: "Partners / advisors / introducers",
    description: "Low-friction connect-and-follow-up.",
  },
];

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusTone(status: string): string {
  switch (status) {
    case "replied":
      return "text-status-success";
    case "completed":
      return "text-status-info";
    case "stopped":
      return "text-fg-muted";
    default:
      return "text-gold-300";
  }
}

// Outreach Studio — the dedicated cadence workspace. Build a sequence from a
// template, enroll targets, and advance each enrollment through the gate: Tier 1
// dispatches immediately; Tier 2/3 land in approvals. Mirrors the agent-native
// Source surfaces (SourcingIntel) in tone + tokens.
export function OutreachStudio({ live }: { live: boolean }) {
  const [sequences, setSequences] = useState<SequenceWithSteps[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [enrollments, setEnrollments] = useState<EnrollmentWithProgress[]>([]);
  const [enrollName, setEnrollName] = useState("");
  const [enrollEmail, setEnrollEmail] = useState("");
  const [enrollPhone, setEnrollPhone] = useState("");
  const [enrollRole, setEnrollRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const loadedOnce = useRef(false);

  async function loadSequences() {
    setLoading(true);
    setError(null);
    try {
      const res = await listOutreachSequences();
      if (res.ok) {
        setSequences(res.sequences ?? []);
        if (!activeId && res.sequences?.length) setActiveId(res.sequences[0].id);
      } else setError(res.error ?? "Could not load sequences.");
    } catch {
      setError("Could not load sequences.");
    } finally {
      setLoading(false);
    }
  }

  async function loadEnrollments(sequenceId: string) {
    try {
      const res = await listOutreachEnrollments(sequenceId);
      if (res.ok) setEnrollments(res.enrollments ?? []);
    } catch {
      /* non-fatal */
    }
  }

  useEffect(() => {
    if (!loadedOnce.current) {
      loadedOnce.current = true;
      loadSequences();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeId) loadEnrollments(activeId);
    else setEnrollments([]);
     
  }, [activeId]);

  async function buildFromTemplate(key: string) {
    if (creating) return;
    setCreating(true);
    setNote(null);
    setError(null);
    try {
      const res = await createOutreachSequence({ name: "", templateKey: key });
      if (res.ok && res.sequence) {
        setNote(`Built “${res.sequence.name}”.`);
        await loadSequences();
        setActiveId(res.sequence.id);
      } else setError(res.error ?? "Could not build the sequence.");
    } catch {
      setError("Could not build the sequence.");
    } finally {
      setCreating(false);
    }
  }

  async function enrollTarget() {
    if (!activeId || !enrollName.trim() || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await enrollOutreachTarget({
        sequenceId: activeId,
        subjectName: enrollName.trim(),
        subjectEmail: enrollEmail.trim() || null,
        subjectPhone: enrollPhone.trim() || null,
        subjectRole: enrollRole.trim() || null,
      });
      if (res.ok) {
        setEnrollName("");
        setEnrollEmail("");
        setEnrollPhone("");
        setEnrollRole("");
        await loadEnrollments(activeId);
      } else setError(res.error ?? "Could not enroll target.");
    } catch {
      setError("Could not enroll target.");
    } finally {
      setBusy(false);
    }
  }

  async function advance(enrollmentId: string) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const res = await advanceOutreachEnrollment(enrollmentId);
      if (!res.ok) {
        setError(res.error ?? "Could not advance the step.");
      } else if (res.noop) {
        setNote(res.message ?? "Nothing due to send yet.");
      } else if (res.gated) {
        setNote(`Tier ${res.tier} step — sent to your approvals.`);
      } else {
        setNote(`Step ${res.sentStepOrder ?? ""} dispatched.`);
      }
      if (activeId) await loadEnrollments(activeId);
    } catch {
      setError("Could not advance the step.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSequence(sequenceId: string) {
    if (deleting) return;
    if (!confirm("Delete this sequence and all its enrollments?")) return;
    setDeleting(true);
    try {
      const res = await deleteOutreachSequenceAction(sequenceId);
      if (!res.ok) { setError(res.error ?? "Could not delete sequence."); return; }
      setSequences((prev) => prev.filter((s) => s.id !== sequenceId));
      if (activeId === sequenceId) {
        const next = sequences.find((s) => s.id !== sequenceId);
        setActiveId(next?.id ?? null);
      }
    } catch {
      setError("Could not delete sequence.");
    } finally {
      setDeleting(false);
    }
  }

  async function clearSequences() {
    if (deleting) return;
    if (!confirm("Delete all sequences? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await clearOutreachSequencesAction();
      if (!res.ok) { setError(res.error ?? "Could not clear sequences."); return; }
      setSequences([]);
      setActiveId(null);
      setEnrollments([]);
    } catch {
      setError("Could not clear sequences.");
    } finally {
      setDeleting(false);
    }
  }

  const active = sequences.find((s) => s.id === activeId) ?? null;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            ✶ Outreach Studio
          </span>
          {!live ? (
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              local mode
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-fg-secondary">
          Build a multi-touch cadence from a template, enroll targets, and advance each one. Every
          send routes through the gate — Tier 1 dispatches now, Tier 2/3 await your approval.
        </p>
      </header>

      {/* Build from template */}
      <section className="rounded-2xl border border-gold-500/25 bg-gradient-to-b from-gold-500/[0.06] to-transparent p-4">
        <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
          Build a sequence
        </span>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              disabled={creating}
              onClick={() => buildFromTemplate(t.key)}
              className="rounded-xl border border-line bg-surface-1 p-3 text-left transition hover:border-gold-500/40 disabled:opacity-50"
            >
              <span className="block text-sm font-medium text-fg-primary">{t.name}</span>
              <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-wider text-gold-400">
                {humanize(t.channel)}
              </span>
              <span className="mt-1 block text-xs text-fg-secondary">{t.description}</span>
            </button>
          ))}
        </div>
      </section>

      {note ? <p className="mt-3 text-[11px] text-gold-300">{note}</p> : null}
      {error ? (
        <p className="mt-3 rounded-md border border-status-danger/40 bg-status-danger/5 px-3 py-2 text-xs text-status-danger">
          {error}
        </p>
      ) : null}

      {/* Sequence picker */}
      {loading ? (
        <p className="mt-5 text-sm text-fg-muted">Loading sequences…</p>
      ) : sequences.length ? (
        <div className="mt-5">
          <div className="flex flex-wrap gap-1.5">
            {sequences.map((s) => (
              <div key={s.id} className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setActiveId(s.id)}
                  className={`flex items-center gap-1.5 rounded-l-full border px-2.5 py-1 text-xs transition ${
                    s.id === activeId
                      ? "border-gold-500/50 bg-gold-500/10 text-fg-primary"
                      : "border-line text-fg-muted hover:bg-surface-2"
                  }`}
                >
                  <span>{s.name}</span>
                  <span className="font-mono text-[10px] text-fg-muted">{s.steps.length} steps</span>
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => deleteSequence(s.id)}
                  aria-label={`Delete ${s.name}`}
                  className="rounded-r-full border border-l-0 border-line px-2 py-1 text-[10px] text-fg-muted transition hover:border-status-danger/40 hover:text-status-danger disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={deleting}
            onClick={clearSequences}
            className="mt-2 rounded border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted transition hover:border-status-danger/40 hover:text-status-danger disabled:opacity-40"
          >
            Clear all
          </button>
        </div>
      ) : (
        <p className="mt-5 rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm text-fg-secondary">
          No sequences yet. Build one from a template above to get started.
        </p>
      )}

      {/* Active sequence: steps + enrollments */}
      {active ? (
        <div className="mt-5 space-y-5">
          {/* Steps */}
          <div className="rounded-2xl border border-line bg-surface-1 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-fg-primary">{active.name}</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                {humanize(active.channel ?? "")}
                {active.audience ? ` · ${active.audience}` : ""}
              </span>
            </div>
            <ol className="mt-3 space-y-2">
              {active.steps.map((st) => (
                <li key={st.id} className="flex items-start gap-3 rounded-lg border border-line bg-surface-0 p-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold-400 font-mono text-[10px] text-surface-0">
                    {st.step_order}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm text-fg-primary">{st.subject || "(no subject)"}</span>
                      <span className="rounded-full border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
                        {humanize(st.action)}
                      </span>
                      <span className="font-mono text-[10px] text-fg-muted">
                        {st.delay_days === 0 ? "immediate" : `+${st.delay_days}d`}
                      </span>
                    </div>
                    {st.body ? <p className="mt-1 line-clamp-2 text-xs text-fg-secondary">{st.body}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Enroll */}
          <div className="rounded-2xl border border-line bg-surface-1 p-4">
            <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
              Enroll a target
            </span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                value={enrollName}
                onChange={(e) => setEnrollName(e.target.value)}
                placeholder="Target name"
                className="rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary outline-none focus:border-gold-500"
              />
              <input
                value={enrollRole}
                onChange={(e) => setEnrollRole(e.target.value)}
                placeholder="Role (optional)"
                className="rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary outline-none focus:border-gold-500"
              />
              <input
                value={enrollEmail}
                onChange={(e) => setEnrollEmail(e.target.value)}
                placeholder="Email (optional)"
                className="rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary outline-none focus:border-gold-500"
              />
              <input
                value={enrollPhone}
                onChange={(e) => setEnrollPhone(e.target.value)}
                placeholder="Phone (optional)"
                className="rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary outline-none focus:border-gold-500"
              />
            </div>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={enrollTarget}
                disabled={busy || !enrollName.trim()}
                className="shrink-0 rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-50"
              >
                Enroll
              </button>
            </div>
          </div>

          {/* Enrollments + progress */}
          <div className="rounded-2xl border border-line bg-surface-1 p-4">
            <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
              Enrollments
            </span>
            {enrollments.length ? (
              <div className="mt-3 space-y-2">
                {enrollments.map(({ enrollment, progress }) => (
                  <div
                    key={enrollment.id}
                    className="flex items-center gap-3 rounded-lg border border-line bg-surface-0 p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm text-fg-primary">{enrollment.subject_name}</span>
                        {(enrollment as { subject_role?: string | null }).subject_role && (
                          <span className="font-mono text-[10px] text-fg-muted">
                            {(enrollment as { subject_role?: string | null }).subject_role}
                          </span>
                        )}
                        <span className={`font-mono text-[10px] uppercase tracking-wider ${statusTone(enrollment.status)}`}>
                          {progress.label}
                        </span>
                      </div>
                      {((enrollment as { subject_email?: string | null }).subject_email || (enrollment as { subject_phone?: string | null }).subject_phone) && (
                        <div className="flex gap-3 mt-0.5">
                          {(enrollment as { subject_email?: string | null }).subject_email && (
                            <span className="font-mono text-[10px] text-fg-muted">{(enrollment as { subject_email?: string | null }).subject_email}</span>
                          )}
                          {(enrollment as { subject_phone?: string | null }).subject_phone && (
                            <span className="font-mono text-[10px] text-fg-muted">{(enrollment as { subject_phone?: string | null }).subject_phone}</span>
                          )}
                        </div>
                      )}
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
                        <div
                          className="h-full rounded-full bg-gold-400 transition-[width]"
                          style={{ width: `${progress.pct}%` }}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => advance(enrollment.id)}
                      disabled={busy || progress.nextStepOrder == null}
                      className="shrink-0 rounded-md border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 text-[11px] font-medium text-gold-200 transition hover:bg-gold-500/20 disabled:opacity-50"
                    >
                      {progress.nextStepOrder == null ? "Done" : `Send step ${progress.nextStepOrder}`}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-fg-secondary">No one enrolled yet.</p>
            )}
            <p className="mt-3 text-[11px] text-fg-muted">
              Sending advances the enrollment by its next due step. Tier 1 dispatches immediately;
              Tier 2/3 are routed to your approvals — nothing leaves the building uncontrolled.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
