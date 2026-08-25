"use client";

import { useState } from "react";
import {
  DAY_LABELS,
  DAY_LABELS_SHORT,
  type SchedulingAvailabilityRule,
} from "@/lib/meetings/scheduling";
import { TimezoneSelect } from "@/components/scheduling/TimezoneSelect";
import type { HostEventType, HostSchedulingPage } from "./scheduling-types";

const NOTICE_CHOICES = [
  { label: "No minimum", value: 0 },
  { label: "1 hour", value: 60 },
  { label: "4 hours", value: 240 },
  { label: "24 hours", value: 1440 },
  { label: "2 days", value: 2880 },
];

const BUFFER_CHOICES = [0, 5, 10, 15, 30];
const WINDOW_CHOICES = [7, 14, 30, 60, 90];

/**
 * Availability + meeting types for the host's scheduling link. Every change is
 * saved explicitly: a mis-typed working hour silently going live would quietly
 * open (or close) someone's calendar.
 */
export function SchedulingSettings({
  page,
  eventTypes,
  onPageChange,
  onEventTypesChange,
}: {
  page: HostSchedulingPage;
  eventTypes: HostEventType[];
  onPageChange: (page: HostSchedulingPage) => void;
  onEventTypesChange: (eventTypes: HostEventType[]) => void;
}) {
  const [draft, setDraft] = useState<HostSchedulingPage>(page);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function patchDraft(patch: Partial<HostSchedulingPage>) {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  }

  function ruleFor(day: number): SchedulingAvailabilityRule | null {
    return draft.availability.find((r) => r.day === day) ?? null;
  }

  function toggleDay(day: number, enabled: boolean) {
    const rest = draft.availability.filter((r) => r.day !== day);
    patchDraft({
      availability: enabled
        ? [...rest, { day, start: "09:00", end: "17:00" }].sort((a, b) => a.day - b.day)
        : rest,
    });
  }

  function setDayTime(day: number, field: "start" | "end", value: string) {
    patchDraft({
      availability: draft.availability.map((r) => (r.day === day ? { ...r, [field]: value } : r)),
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/meetings/scheduling", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: draft.slug,
          displayName: draft.displayName,
          headline: draft.headline,
          timezone: draft.timezone,
          availability: draft.availability,
          bufferMinutes: draft.bufferMinutes,
          minNoticeMinutes: draft.minNoticeMinutes,
          bookingWindowDays: draft.bookingWindowDays,
          isActive: draft.isActive,
        }),
      });
      const data = (await res.json()) as { error?: string; page?: HostSchedulingPage };
      if (!res.ok || !data.page) throw new Error(data.error ?? "Could not save.");
      setDraft(data.page);
      onPageChange(data.page);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <SectionHeading title="Your link" hint="The handle people see when you share it." />

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-[var(--fg-secondary)]">Link handle</span>
          <div className="flex items-center rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5 focus-within:ring-2 focus-within:ring-[var(--gold-400)]">
            <span className="shrink-0 text-sm text-[var(--fg-muted)]">/book/</span>
            <input
              type="text"
              value={draft.slug}
              onChange={(e) => patchDraft({ slug: e.target.value })}
              className="w-full bg-transparent text-sm text-[var(--fg-primary)] focus:outline-none"
            />
          </div>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-[var(--fg-secondary)]">Display name</span>
          <input
            type="text"
            value={draft.displayName}
            onChange={(e) => patchDraft({ displayName: e.target.value })}
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5 text-sm text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-[var(--fg-secondary)]">Headline (optional)</span>
          <input
            type="text"
            value={draft.headline ?? ""}
            placeholder="Partner, FundExecs Capital"
            onChange={(e) => patchDraft({ headline: e.target.value })}
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-[var(--fg-secondary)]">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => patchDraft({ isActive: e.target.checked })}
            className="h-4 w-4 accent-[var(--gold-400)]"
          />
          Link is live and accepting bookings
        </label>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading title="Weekly hours" hint="When you're bookable, in your own timezone." />

        <TimezoneSelect value={draft.timezone} onChange={(tz) => patchDraft({ timezone: tz })} id="host-timezone" />

        <div className="flex flex-col gap-2">
          {DAY_LABELS.map((label, day) => {
            const rule = ruleFor(day);
            return (
              <div key={label} className="flex flex-wrap items-center gap-3">
                <label className="flex w-32 shrink-0 items-center gap-2 text-sm text-[var(--fg-secondary)]">
                  <input
                    type="checkbox"
                    checked={!!rule}
                    onChange={(e) => toggleDay(day, e.target.checked)}
                    className="h-4 w-4 accent-[var(--gold-400)]"
                  />
                  <span className="sm:hidden">{DAY_LABELS_SHORT[day]}</span>
                  <span className="hidden sm:inline">{label}</span>
                </label>
                {rule ? (
                  <div className="flex items-center gap-2">
                    <TimeInput value={rule.start} onChange={(v) => setDayTime(day, "start", v)} label={`${label} start`} />
                    <span className="text-xs text-[var(--fg-muted)]">to</span>
                    <TimeInput value={rule.end} onChange={(v) => setDayTime(day, "end", v)} label={`${label} end`} />
                  </div>
                ) : (
                  <span className="text-xs text-[var(--fg-muted)]">Unavailable</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading title="Booking rules" hint="Guardrails applied to every meeting type." />

        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Buffer between meetings"
            value={draft.bufferMinutes}
            onChange={(v) => patchDraft({ bufferMinutes: v })}
            options={BUFFER_CHOICES.map((m) => ({ label: m === 0 ? "None" : `${m} min`, value: m }))}
          />
          <Select
            label="Minimum notice"
            value={draft.minNoticeMinutes}
            onChange={(v) => patchDraft({ minNoticeMinutes: v })}
            options={NOTICE_CHOICES}
          />
          <Select
            label="Bookable up to"
            value={draft.bookingWindowDays}
            onChange={(v) => patchDraft({ bookingWindowDays: v })}
            options={WINDOW_CHOICES.map((d) => ({ label: `${d} days out`, value: d }))}
          />
        </div>
      </section>

      {error ? (
        <p className="rounded-lg border border-[var(--status-danger)]/20 bg-[var(--status-danger)]/10 px-3 py-2 text-xs text-[var(--status-danger)]">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-[var(--gold-400)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--gold-500)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save availability"}
        </button>
        {saved ? <span className="text-xs text-[var(--gold-400)]">Saved.</span> : null}
      </div>

      <EventTypesEditor eventTypes={eventTypes} onChange={onEventTypesChange} />
    </div>
  );
}

function EventTypesEditor({
  eventTypes,
  onChange,
}: {
  eventTypes: HostEventType[];
  onChange: (eventTypes: HostEventType[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(30);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function create() {
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/meetings/scheduling/event-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, durationMinutes: duration, requiresApproval }),
      });
      const data = (await res.json()) as { error?: string; eventType?: HostEventType };
      if (!res.ok || !data.eventType) throw new Error(data.error ?? "Could not add that.");
      onChange([...eventTypes, data.eventType]);
      setTitle("");
      setRequiresApproval(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that.");
    } finally {
      setCreating(false);
    }
  }

  async function patch(id: string, body: Partial<HostEventType>) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/meetings/scheduling/event-types/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string; eventType?: HostEventType };
      if (!res.ok || !data.eventType) throw new Error(data.error ?? "Could not update that.");
      onChange(eventTypes.map((t) => (t.id === id ? data.eventType! : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/meetings/scheduling/event-types/${id}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string; deleted?: boolean; message?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not remove that.");
      if (data.deleted) {
        onChange(eventTypes.filter((t) => t.id !== id));
      } else {
        // Kept, but turned off — it still has bookings people are expecting.
        onChange(eventTypes.map((t) => (t.id === id ? { ...t, isActive: false } : t)));
        setNotice(data.message ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading title="Meeting types" hint="What people can book, and for how long." />

      <ul className="flex flex-col gap-2">
        {eventTypes.map((type) => (
          <li
            key={type.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-3"
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-[var(--fg-primary)]">{type.title}</span>
              <span className="text-xs text-[var(--fg-muted)]">
                /{type.slug} · {type.durationMinutes} min
                {type.requiresApproval ? " · you approve each request" : ""}
                {type.isActive ? "" : " · hidden"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busyId === type.id}
                onClick={() => void patch(type.id, { isActive: !type.isActive })}
                className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-xs text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)] disabled:opacity-50"
              >
                {type.isActive ? "Hide" : "Show"}
              </button>
              <button
                type="button"
                disabled={busyId === type.id}
                onClick={() => void patch(type.id, { requiresApproval: !type.requiresApproval })}
                className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-xs text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)] disabled:opacity-50"
              >
                {type.requiresApproval ? "Auto-confirm" : "Require approval"}
              </button>
              <button
                type="button"
                disabled={busyId === type.id}
                onClick={() => void remove(type.id)}
                className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-xs text-[var(--fg-muted)] transition-colors hover:text-[var(--status-danger)] disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-[var(--line)] px-3 py-3">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
          <span className="text-xs text-[var(--fg-secondary)]">New meeting type</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="LP catch-up"
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
          />
        </label>
        <Select
          label="Length"
          value={duration}
          onChange={setDuration}
          options={[15, 20, 30, 45, 60, 90].map((m) => ({ label: `${m} min`, value: m }))}
        />
        <label className="flex items-center gap-2 pb-2 text-xs text-[var(--fg-secondary)]">
          <input
            type="checkbox"
            checked={requiresApproval}
            onChange={(e) => setRequiresApproval(e.target.checked)}
            className="h-4 w-4 accent-[var(--gold-400)]"
          />
          I approve each request
        </label>
        <button
          type="button"
          onClick={() => void create()}
          disabled={creating || !title.trim()}
          className="rounded-lg border border-[var(--gold-400)]/40 bg-[var(--gold-400)]/10 px-4 py-2 text-sm font-medium text-[var(--gold-400)] transition-colors hover:bg-[var(--gold-400)]/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? "Adding…" : "Add"}
        </button>
      </div>

      {notice ? <p className="text-xs text-[var(--fg-muted)]">{notice}</p> : null}
      {error ? <p className="text-xs text-[var(--status-danger)]">{error}</p> : null}
    </section>
  );
}

function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{title}</h3>
      <p className="text-xs text-[var(--fg-muted)]">{hint}</p>
    </div>
  );
}

function TimeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type="time"
      aria-label={label}
      value={value}
      step={300}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-2 py-1.5 text-sm text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
    />
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  options: Array<{ label: string; value: number }>;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-[var(--fg-secondary)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
