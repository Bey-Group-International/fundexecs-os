"use client";

// The call's Notes tab: what the notetaker has picked up so far, your own
// notes, the moments you bookmarked, and — for the host — the notetaker's
// controls and the firm's glossary.

import { useCallback, useEffect, useRef, useState } from "react";
import { chatClock } from "@/lib/meetings/chat";
import {
  LIVE_NOTES_MIN_INTERVAL_MS,
  LIVE_NOTES_MIN_NEW_LINES,
  NOTETAKER_LANGS,
  canSeeLiveNotes,
  type NotetakerSettings,
} from "@/lib/meetings/notetaker";

interface LiveNotes {
  key_points: string[];
  decisions: string[];
  action_items: string[];
  summary: string;
  generatedAt: number | null;
  lines: number;
}

interface BookmarkRow {
  id: string;
  at: string;
  label: string | null;
}

const NOTES_SAVE_DELAY_MS = 1500;

function draftKey(meetingId: string) {
  return `fx-meeting-notes:${meetingId}`;
}

function readDraft(meetingId: string): string | null {
  try {
    return window.localStorage.getItem(draftKey(meetingId));
  } catch {
    return null;
  }
}

function writeDraft(meetingId: string, body: string | null) {
  try {
    if (body === null) window.localStorage.removeItem(draftKey(meetingId));
    else window.localStorage.setItem(draftKey(meetingId), body);
  } catch {
    // No storage: the server copy is the only one.
  }
}

function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  return m === 1 ? "1 min ago" : `${m} min ago`;
}

export function NotesPanel({
  meetingId,
  isHost,
  signedIn,
  settings,
  onSettingsChange,
  lineCount,
  bookmarkVersion = 0,
  onBookmark,
  authQuery = "",
}: {
  meetingId: string | null;
  isHost: boolean;
  /** A guest has no account to keep notes or bookmarks against. */
  signedIn: boolean;
  settings: NotetakerSettings;
  /** Host only: change the notetaker's settings. Resolves false when it failed. */
  onSettingsChange?: (patch: Partial<NotetakerSettings>) => Promise<boolean>;
  /** Final transcript lines heard so far in this room, to know when notes are worth refreshing. */
  lineCount: number;
  /** Bumped when a bookmark is made elsewhere (the Transcript tab), to re-read the list. */
  bookmarkVersion?: number;
  onBookmark?: (label?: string) => Promise<boolean>;
  /** "?guestKey=…" for an admitted guest, so the notes routes know who is asking. */
  authQuery?: string;
}) {
  const showNotes = canSeeLiveNotes(settings, isHost);
  return (
    <div className="flex flex-col gap-4">
      {isHost && onSettingsChange && <NotetakerControls settings={settings} onChange={onSettingsChange} />}
      {settings.paused && (
        <p className="rounded-lg border border-[var(--status-warning,#f59e0b)]/40 bg-[var(--status-warning,#f59e0b)]/10 px-3 py-2 text-xs text-[var(--fg-primary)]">
          The notetaker is paused. Nothing said now is transcribed or noted.
        </p>
      )}
      {meetingId && showNotes && <LiveNotesSection meetingId={meetingId} paused={settings.paused} lineCount={lineCount} authQuery={authQuery} />}
      {meetingId && !showNotes && (
        <p className="text-xs text-[var(--fg-muted)]">The host is keeping the live notes to themselves. The report will be shared after the meeting.</p>
      )}
      {meetingId && signedIn && <MyNotes meetingId={meetingId} />}
      {meetingId && signedIn && onBookmark && <Bookmarks meetingId={meetingId} version={bookmarkVersion} onBookmark={onBookmark} paused={settings.paused} />}
      {!signedIn && <p className="text-xs text-[var(--fg-muted)]">Sign in to keep your own notes and bookmarks.</p>}
    </div>
  );
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-muted)]">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function List({ items, label }: { items: string[]; label: string }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-xs font-medium text-[var(--fg-primary)]">{label}</p>
      <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-sm text-[var(--fg-primary)]">
        {items.map((t, i) => (
          <li key={i} className="break-words">
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LiveNotesSection({ meetingId, paused, lineCount, authQuery }: { meetingId: string; paused: boolean; lineCount: number; authQuery: string }) {
  const [notes, setNotes] = useState<LiveNotes | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastAsk = useRef<{ at: number; lines: number }>({ at: 0, lines: 0 });

  const ask = useCallback(
    async (force: boolean) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/meetings/${meetingId}/live-notes${authQuery}`, {
          method: force ? "POST" : "GET",
          headers: force ? { "Content-Type": "application/json" } : undefined,
          body: force ? JSON.stringify({ force: true }) : undefined,
        });
        const body = (await res.json().catch(() => ({}))) as { notes?: LiveNotes; error?: string };
        if (body.notes) setNotes(body.notes);
        setError(res.ok ? body.error ?? null : body.error ?? "Couldn't load the notes.");
      } catch {
        setError("Couldn't reach the notetaker.");
      } finally {
        setBusy(false);
      }
    },
    [meetingId, authQuery],
  );

  const refreshIfDue = useCallback(async () => {
    const since = Date.now() - lastAsk.current.at;
    if (lineCount - lastAsk.current.lines < LIVE_NOTES_MIN_NEW_LINES || since < LIVE_NOTES_MIN_INTERVAL_MS) return;
    lastAsk.current = { at: Date.now(), lines: lineCount };
    try {
      const res = await fetch(`/api/meetings/${meetingId}/live-notes${authQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await res.json().catch(() => ({}))) as { notes?: LiveNotes };
      if (body.notes) setNotes(body.notes);
    } catch {
      // Tried again on the next tick.
    }
  }, [meetingId, lineCount, authQuery]);

  useEffect(() => {
    void ask(false);
  }, [ask]);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => {
      setNow(Date.now());
      void refreshIfDue();
    }, 15_000);
    return () => clearInterval(t);
  }, [paused, refreshIfDue]);

  const empty = !notes || (!notes.summary && !notes.key_points.length && !notes.decisions.length && !notes.action_items.length);

  return (
    <Section
      title="Live notes"
      aside={
        <button
          type="button"
          onClick={() => ask(true)}
          disabled={busy || paused}
          className="min-h-8 rounded-md px-2 text-[11px] text-[var(--gold-400)] hover:underline disabled:opacity-50"
        >
          {busy ? "Updating…" : "Refresh"}
        </button>
      }
    >
      {empty ? (
        <p className="text-xs text-[var(--fg-muted)]">
          {paused ? "Paused." : "Notes appear here once there's been some conversation. They update about once a minute."}
        </p>
      ) : (
        <div className="flex flex-col gap-3" data-live-notes>
          {notes!.summary && <p className="text-sm text-[var(--fg-primary)]">{notes!.summary}</p>}
          <List items={notes!.key_points} label="Key points" />
          <List items={notes!.decisions} label="Decisions" />
          <List items={notes!.action_items} label="Action items" />
          {notes!.generatedAt && (
            <p className="text-[10px] text-[var(--fg-muted)]">
              Updated {ago(notes!.generatedAt, now)} · written by AI from the transcript; the report is the final word.
            </p>
          )}
        </div>
      )}
      {error && <p className="text-[11px] text-[var(--status-warning,#f59e0b)]">{error}</p>}
    </Section>
  );
}

function MyNotes({ meetingId }: { meetingId: string }) {
  const [body, setBody] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "local">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      let server = "";
      try {
        const res = await fetch(`/api/meetings/${meetingId}/notes`);
        if (res.ok) server = ((await res.json()) as { body?: string }).body ?? "";
      } catch {
        // The draft below, if any, is all there is.
      }
      if (!alive) return;
      // An unsaved draft on this device is newer than the server's copy.
      const draft = readDraft(meetingId);
      const start = draft ?? server;
      latest.current = start;
      setBody(start);
      setLoaded(true);
      if (draft !== null && draft !== server) setStatus("local");
    })();
    return () => {
      alive = false;
    };
  }, [meetingId]);

  const save = useCallback(async () => {
    const text = latest.current;
    setStatus("saving");
    try {
      const res = await fetch(`/api/meetings/${meetingId}/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
        keepalive: true,
      });
      if (!res.ok) throw new Error(String(res.status));
      if (latest.current === text) writeDraft(meetingId, null);
      setStatus("saved");
    } catch {
      setStatus("local");
    }
  }, [meetingId]);

  // Whatever is waiting goes out when the panel closes or the page goes.
  useEffect(() => {
    const flush = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        void save();
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [save]);

  function change(text: string) {
    setBody(text);
    latest.current = text;
    writeDraft(meetingId, text);
    setStatus("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void save();
    }, NOTES_SAVE_DELAY_MS);
  }

  return (
    <Section
      title="My notes"
      aside={
        <span className="text-[10px] text-[var(--fg-muted)]" aria-live="polite">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "local" ? "Saved on this device — will sync" : ""}
        </span>
      }
    >
      <textarea
        value={body}
        onChange={(e) => change(e.target.value)}
        disabled={!loaded}
        rows={6}
        maxLength={20_000}
        placeholder="Only you can see these. The host's notes help write the report."
        aria-label="My notes"
        className="w-full resize-y rounded-md border border-[var(--line)] bg-[var(--surface-0)] p-2 text-sm text-[var(--fg-primary)]"
      />
    </Section>
  );
}

function Bookmarks({
  meetingId,
  version,
  onBookmark,
  paused,
}: {
  meetingId: string;
  version: number;
  onBookmark: (label?: string) => Promise<boolean>;
  paused: boolean;
}) {
  const [rows, setRows] = useState<BookmarkRow[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/meetings/${meetingId}/bookmarks`);
      if (res.ok) setRows(((await res.json()) as { bookmarks?: BookmarkRow[] }).bookmarks ?? []);
    } catch {
      // Kept as it was.
    }
  }, [meetingId]);

  useEffect(() => {
    void load();
  }, [load, version]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await onBookmark(label.trim() || undefined);
    setBusy(false);
    if (ok) {
      setLabel("");
      void load();
    }
  }

  async function remove(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
    try {
      await fetch(`/api/meetings/${meetingId}/bookmarks/${id}`, { method: "DELETE" });
    } catch {
      void load();
    }
  }

  return (
    <Section title="Bookmarks">
      <form onSubmit={add} className="flex gap-1.5">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={200}
          placeholder="What just happened? (optional)"
          aria-label="Bookmark label"
          className="min-w-0 flex-1 min-h-9 rounded-md border border-[var(--line)] bg-[var(--surface-0)] px-2 text-sm text-[var(--fg-primary)]"
        />
        <button
          type="submit"
          disabled={busy || paused}
          className="shrink-0 min-h-9 rounded-md bg-[var(--gold-400)] px-3 text-xs font-medium text-black disabled:opacity-50"
        >
          🔖 Bookmark
        </button>
      </form>
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label="Your bookmarks">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              <span className="font-mono text-[11px] tabular-nums text-[var(--fg-muted)]">{chatClock(Date.parse(r.at))}</span>
              <span className="min-w-0 flex-1 truncate text-[var(--fg-primary)]">{r.label ?? "Bookmarked moment"}</span>
              <button
                type="button"
                onClick={() => remove(r.id)}
                aria-label={`Remove bookmark ${r.label ?? "at " + chatClock(Date.parse(r.at))}`}
                className="shrink-0 min-h-8 px-2 text-[11px] text-[var(--fg-muted)] hover:text-[var(--status-danger,#ef4444)]"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-[var(--fg-muted)]">Flag a moment and it shows up in the report.</p>
      )}
    </Section>
  );
}

function NotetakerControls({
  settings,
  onChange,
}: {
  settings: NotetakerSettings;
  onChange: (patch: Partial<NotetakerSettings>) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [glossaryOpen, setGlossaryOpen] = useState(false);

  async function apply(patch: Partial<NotetakerSettings>) {
    setBusy(true);
    setError(null);
    const ok = await onChange(patch);
    setBusy(false);
    if (!ok) setError("Couldn't change the notetaker. Try again.");
  }

  const field = "min-h-9 rounded-md border border-[var(--line)] bg-[var(--surface-0)] px-2 text-xs text-[var(--fg-primary)]";

  return (
    <section aria-label="Notetaker controls" className="flex flex-col gap-2 rounded-lg border border-[var(--line)] p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-muted)]">Notetaker</h3>
        <button
          type="button"
          onClick={() => apply({ paused: !settings.paused })}
          disabled={busy}
          className={`min-h-9 rounded-md px-3 text-xs font-medium ${settings.paused ? "bg-[var(--gold-400)] text-black" : "border border-[var(--line)] text-[var(--fg-primary)]"} disabled:opacity-50`}
        >
          {settings.paused ? "Resume notetaker" : "Pause notetaker"}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[11px] text-[var(--fg-muted)]">
          Live notes visible to
          <select
            className={field}
            value={settings.notesVisibility}
            disabled={busy}
            onChange={(e) => apply({ notesVisibility: e.target.value as NotetakerSettings["notesVisibility"] })}
            aria-label="Live notes visible to"
          >
            <option value="everyone">Everyone in the call</option>
            <option value="host">Only me</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-[var(--fg-muted)]">
          Transcription language
          <select
            className={field}
            value={settings.lang ?? ""}
            disabled={busy}
            onChange={(e) => apply({ lang: e.target.value || null })}
            aria-label="Transcription language"
          >
            <option value="">Each person&apos;s browser language</option>
            {NOTETAKER_LANGS.map((l) => (
              <option key={l.tag} value={l.tag}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="button"
        onClick={() => setGlossaryOpen((v) => !v)}
        aria-expanded={glossaryOpen}
        className="self-start min-h-8 text-[11px] text-[var(--gold-400)] hover:underline"
      >
        {glossaryOpen ? "Hide glossary" : "Names & terms glossary"}
      </button>
      {glossaryOpen && <GlossaryEditor />}
      {error && <p className="text-[11px] text-[var(--status-danger,#ef4444)]">{error}</p>}
    </section>
  );
}

function GlossaryEditor() {
  const [terms, setTerms] = useState<Array<{ id: string; term: string }>>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/meetings/glossary");
        if (res.ok) setTerms(((await res.json()) as { terms?: Array<{ id: string; term: string }> }).terms ?? []);
      } catch {
        // Empty list.
      }
    })();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const term = input.trim();
    if (!term) return;
    setError(null);
    try {
      const res = await fetch("/api/meetings/glossary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term }),
      });
      const body = (await res.json().catch(() => ({}))) as { term?: { id: string; term: string }; error?: string };
      if (!res.ok || !body.term) {
        setError(body.error ?? "Couldn't add that term.");
        return;
      }
      setTerms((prev) => [...prev, body.term!].sort((a, b) => a.term.localeCompare(b.term)));
      setInput("");
    } catch {
      setError("Couldn't add that term.");
    }
  }

  async function remove(id: string) {
    setTerms((prev) => prev.filter((t) => t.id !== id));
    try {
      await fetch(`/api/meetings/glossary?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      // Shown removed; it returns on the next load if the delete failed.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-[var(--fg-muted)]">
        Names the transcript gets wrong — a fund, a company, an acronym. New lines use these spellings, and the report is told them. Shared across your firm.
      </p>
      <form onSubmit={add} className="flex gap-1.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={80}
          placeholder="e.g. Dunbar Capital, LPAC"
          aria-label="Glossary term"
          className="min-w-0 flex-1 min-h-9 rounded-md border border-[var(--line)] bg-[var(--surface-0)] px-2 text-xs text-[var(--fg-primary)]"
        />
        <button type="submit" className="shrink-0 min-h-9 rounded-md border border-[var(--line)] px-3 text-xs text-[var(--fg-primary)]">
          Add
        </button>
      </form>
      {error && <p className="text-[11px] text-[var(--status-danger,#ef4444)]">{error}</p>}
      {terms.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Glossary terms">
          {terms.map((t) => (
            <li key={t.id} className="flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--fg-primary)]">
              {t.term}
              <button type="button" onClick={() => remove(t.id)} aria-label={`Remove ${t.term}`} className="text-[var(--fg-muted)] hover:text-[var(--status-danger,#ef4444)]">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
