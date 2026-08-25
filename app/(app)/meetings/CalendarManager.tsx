"use client";

// The calendar-management hub, opened from "Manage calendar" on the scheduling
// link card. Two things live here:
//
//   Blocked time — the list half of the blocking feature. Blocks could already
//   be made and cleared by clicking around the calendar grid, but there was
//   nowhere to see what you had blocked without hunting week by week.
//
//   Calendar connection — honest status only. See
//   app/api/meetings/calendar-status/route.ts: no provider is actually wired,
//   so this panel reports that rather than offering a Connect button that
//   wouldn't connect anything.
//
// Availability and meeting types deliberately stay under "Manage availability"
// on the same card: those shape the public booking link, where this shapes the
// host's own calendar.
import { useCallback, useEffect, useState } from "react";
import { defaultBlockEnd, type SerializedBlock } from "@/lib/meetings/blocks";

type Tab = "blocked" | "connection";

interface CalendarStatus {
  googleAccountConnected: boolean;
  googleAccountLabel: string | null;
  providerSyncAvailable: boolean;
  meetingsWithSyncEnabled: number;
}

/** Local wall-clock value for a datetime-local input, from an ISO instant. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function formatSpan(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return "";
  const day = start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const t = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  // A block crossing midnight has to name the second day, or "10 PM – 6 AM"
  // reads as an eight-hour gap on the same morning.
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay
    ? `${day}, ${t(start)} – ${t(end)}`
    : `${day}, ${t(start)} – ${end.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${t(end)}`;
}

/** The next round half-hour, as a sensible default for a new block. */
function nextHalfHour(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() > 30 ? 60 : 30);
  return d.toISOString();
}

export function CalendarManager() {
  const [tab, setTab] = useState<Tab>("blocked");
  const [blocks, setBlocks] = useState<SerializedBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<CalendarStatus | null>(null);

  // The new-block draft. Null when the form is closed.
  const [draft, setDraft] = useState<{ title: string; startsAt: string; endsAt: string } | null>(null);
  const [editing, setEditing] = useState<SerializedBlock | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // From now forward: a list of blocks you can no longer act on is noise.
      const from = new Date().toISOString();
      const to = new Date(Date.now() + 180 * 86_400_000).toISOString();
      const res = await fetch(`/api/meetings/blocks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Couldn't load your blocked time.");
      }
      const json = (await res.json()) as { blocks?: SerializedBlock[] };
      setBlocks(json.blocks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your blocked time.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void (async () => {
      try {
        const res = await fetch("/api/meetings/calendar-status");
        if (res.ok) setStatus((await res.json()) as CalendarStatus);
      } catch {
        // The connection tab degrades to its unknown state; the blocked-time
        // half must not go down with it.
      }
    })();
  }, [load]);

  async function save(body: { title: string; startsAt: string; endsAt: string }, id?: string) {
    setError(null);
    setBusyId(id ?? "__new__");
    try {
      const res = await fetch(id ? `/api/meetings/blocks/${id}` : "/api/meetings/blocks", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Couldn't save that block.");
      }
      setDraft(null);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that block.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/meetings/blocks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Couldn't clear that block.");
      }
      setBlocks((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't clear that block.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Tabs */}
      <div role="tablist" className="flex gap-1 border-b border-[var(--line)]">
        <TabButton active={tab === "blocked"} onClick={() => setTab("blocked")}>
          Blocked time
        </TabButton>
        <TabButton active={tab === "connection"} onClick={() => setTab("connection")}>
          Calendar connection
        </TabButton>
      </div>

      {error ? (
        <p className="rounded-lg border border-[var(--status-danger)]/30 bg-[var(--status-danger)]/10 px-3 py-2 text-xs text-[var(--status-danger)]">
          {error}
        </p>
      ) : null}

      {tab === "blocked" ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-[var(--fg-muted)]">
              Time kept off your booking link. Scheduling over it warns you, but doesn&rsquo;t stop you.
            </p>
            <button
              type="button"
              onClick={() =>
                setDraft({ title: "", startsAt: nextHalfHour(), endsAt: defaultBlockEnd(nextHalfHour()) })
              }
              className="shrink-0 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--fg-primary)] hover:bg-[var(--surface-0)]"
            >
              Block time
            </button>
          </div>

          {draft ? (
            <BlockForm
              value={draft}
              busy={busyId === "__new__"}
              submitLabel="Block time"
              onChange={setDraft}
              onCancel={() => setDraft(null)}
              onSubmit={() => void save(draft)}
            />
          ) : null}

          {loading ? (
            <p className="text-xs text-[var(--fg-muted)]">Loading…</p>
          ) : blocks.length === 0 && !draft ? (
            <div className="rounded-xl border border-dashed border-[var(--line)] p-6 text-center">
              <p className="text-sm font-medium text-[var(--fg-primary)]">Nothing blocked.</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-[var(--fg-muted)]">
                Block time here, or click any empty slot on the calendar and choose &ldquo;Block time&rdquo;.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {blocks.map((b) =>
                editing?.id === b.id ? (
                  <li key={b.id}>
                    <BlockForm
                      value={{ title: editing.title, startsAt: editing.startsAt, endsAt: editing.endsAt }}
                      busy={busyId === b.id}
                      submitLabel="Save"
                      onChange={(v) => setEditing({ ...editing, ...v })}
                      onCancel={() => setEditing(null)}
                      onSubmit={() =>
                        void save({ title: editing.title, startsAt: editing.startsAt, endsAt: editing.endsAt }, b.id)
                      }
                    />
                  </li>
                ) : (
                  <li
                    key={b.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--fg-primary)]">{b.title}</p>
                      <p className="text-xs tabular-nums text-[var(--fg-muted)]">{formatSpan(b.startsAt, b.endsAt)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(b)}
                        className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--fg-secondary)] hover:bg-[var(--surface-1)]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busyId === b.id}
                        onClick={() => void remove(b.id)}
                        className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--status-danger)] hover:bg-[var(--status-danger)]/10 disabled:opacity-50"
                      >
                        {busyId === b.id ? "Clearing…" : "Clear"}
                      </button>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      ) : (
        <ConnectionPanel status={status} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
        active
          ? "border-[var(--gold-400)] text-[var(--fg-primary)]"
          : "border-transparent text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
      }`}
    >
      {children}
    </button>
  );
}

function BlockForm({
  value,
  busy,
  submitLabel,
  onChange,
  onCancel,
  onSubmit,
}: {
  value: { title: string; startsAt: string; endsAt: string };
  busy: boolean;
  submitLabel: string;
  onChange: (v: { title: string; startsAt: string; endsAt: string }) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block text-xs font-medium text-[var(--fg-secondary)]">
          Label
          <input
            value={value.title}
            onChange={(e) => onChange({ ...value, title: e.target.value })}
            placeholder="Busy"
            className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-2 py-1.5 text-sm text-[var(--fg-primary)]"
          />
        </label>
        <label className="block text-xs font-medium text-[var(--fg-secondary)]">
          From
          <input
            type="datetime-local"
            value={toLocalInput(value.startsAt)}
            onChange={(e) => {
              const iso = fromLocalInput(e.target.value);
              if (iso) onChange({ ...value, startsAt: iso });
            }}
            className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-2 py-1.5 text-sm text-[var(--fg-primary)]"
          />
        </label>
        <label className="block text-xs font-medium text-[var(--fg-secondary)]">
          To
          <input
            type="datetime-local"
            value={toLocalInput(value.endsAt)}
            onChange={(e) => {
              const iso = fromLocalInput(e.target.value);
              if (iso) onChange({ ...value, endsAt: iso });
            }}
            className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-2 py-1.5 text-sm text-[var(--fg-primary)]"
          />
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-xs text-[var(--fg-secondary)] hover:bg-[var(--surface-1)]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onSubmit}
          className="rounded-lg bg-[var(--gold-400)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Calendar connection. Deliberately descriptive rather than interactive: see
 * the note at the top of this file and in the status route. When a provider is
 * genuinely wired, `providerSyncAvailable` flips and this grows real controls.
 */
function ConnectionPanel({ status }: { status: CalendarStatus | null }) {
  if (!status) return <p className="text-xs text-[var(--fg-muted)]">Loading…</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--fg-primary)]">Google account</p>
            <p className="truncate text-xs text-[var(--fg-muted)]">
              {status.googleAccountConnected
                ? status.googleAccountLabel ?? "Connected"
                : "Not connected"}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              status.googleAccountConnected
                ? "bg-emerald-500/15 text-emerald-500"
                : "bg-[var(--surface-1)] text-[var(--fg-muted)]"
            }`}
          >
            {status.googleAccountConnected ? "Connected" : "Not connected"}
          </span>
        </div>
        <p className="mt-2 text-xs text-[var(--fg-muted)]">
          This grant is for sending email from your own mailbox. Connect or change it in Settings →
          Integrations.
        </p>
      </div>

      {!status.providerSyncAvailable ? (
        <div className="rounded-lg border border-[var(--status-warning,#f59e0b)]/40 bg-[var(--status-warning,#f59e0b)]/10 px-3 py-3">
          <p className="text-xs font-medium text-[var(--fg-primary)]">
            Two-way calendar sync isn&rsquo;t connected
          </p>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            FundExecs is the source of truth for your meetings. Turning on sync for a meeting marks it as
            mirrored here, but nothing is written to Google Calendar or Outlook yet — no calendar provider
            is wired up.
            {status.meetingsWithSyncEnabled > 0 ? (
              <>
                {" "}
                <strong className="font-medium text-[var(--fg-secondary)]">
                  {status.meetingsWithSyncEnabled} meeting
                  {status.meetingsWithSyncEnabled === 1 ? " is" : "s are"} flagged to sync
                </strong>{" "}
                and will start mirroring once a provider is connected.
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      <p className="text-xs text-[var(--fg-muted)]">
        Your working hours and bookable meeting types live under{" "}
        <span className="font-medium text-[var(--fg-secondary)]">Manage availability</span>.
      </p>
    </div>
  );
}
