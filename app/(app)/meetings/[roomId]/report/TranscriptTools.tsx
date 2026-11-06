"use client";

// The transcript's tools, beside the search box: download it, see who did
// the talking, and (for the host) put real names on speaker labels. And on
// each line: copy it as a quote with a link to the moment, and (for the host)
// correct what the room misheard, with the original kept.

import { useMemo, useState } from "react";
import {
  EXPORT_FORMATS,
  EXPORT_LABELS,
  durationLabel,
  momentUrl,
  quoteFor,
  talkStats,
  type ExportFormat,
  type OverlayRow,
} from "@/lib/meetings/transcript-tools";

const button =
  "shrink-0 rounded-lg border border-[var(--line)] px-2 py-1 text-xs text-[var(--fg-secondary)] hover:border-gold-400/40";

export function TranscriptToolbar({
  meetingId,
  isHost,
  rows,
  speakers,
  names,
  onRename,
}: {
  meetingId: string;
  isHost: boolean;
  /** The timed rows, as shown (names applied), for talk time. */
  rows: readonly OverlayRow[];
  /** Speaker labels as heard. */
  speakers: readonly string[];
  /** Label as heard → name shown. */
  names: ReadonlyMap<string, string>;
  onRename: (original: string, display: string | null) => Promise<string | null>;
}) {
  const [panel, setPanel] = useState<"none" | "export" | "talk" | "names">("none");
  const toggle = (p: typeof panel) => setPanel((cur) => (cur === p ? "none" : p));
  return (
    <div className="border-b border-[var(--line)] px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} aria-expanded={panel === "export"} onClick={() => toggle("export")}>
          Download
        </button>
        {rows.length > 0 && (
          <button type="button" className={button} aria-expanded={panel === "talk"} onClick={() => toggle("talk")}>
            Talk time
          </button>
        )}
        {isHost && speakers.length > 0 && (
          <button type="button" className={button} aria-expanded={panel === "names"} onClick={() => toggle("names")}>
            Rename speakers
          </button>
        )}
      </div>
      {panel === "export" && <ExportPanel meetingId={meetingId} />}
      {panel === "talk" && <TalkTime rows={rows} />}
      {panel === "names" && <SpeakerNames speakers={speakers} names={names} onRename={onRename} />}
    </div>
  );
}

function ExportPanel({ meetingId }: { meetingId: string }) {
  // The chosen format is held as its position in the fixed list, so the link
  // is only ever built from the list's own values, never from what the page
  // handed back.
  const [choice, setChoice] = useState(0);
  const [timestamps, setTimestamps] = useState(true);
  const format: ExportFormat = EXPORT_FORMATS[choice] ?? "txt";
  const captions = format === "srt" || format === "vtt";
  const href = `/api/meetings/${encodeURIComponent(meetingId)}/transcript/export?format=${format}${!captions && !timestamps ? "&timestamps=0" : ""}`;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--fg-muted)]" data-transcript-export>
      <label className="flex items-center gap-1.5">
        Format
        <select
          value={String(choice)}
          onChange={(e) => {
            const i = Number.parseInt(e.target.value, 10);
            setChoice(Number.isInteger(i) && i >= 0 && i < EXPORT_FORMATS.length ? i : 0);
          }}
          aria-label="Download format"
          className="rounded-md border border-[var(--line)] bg-[var(--surface-0)] px-2 py-1 text-xs text-[var(--fg-primary)]"
        >
          {EXPORT_FORMATS.map((f, i) => (
            <option key={f} value={String(i)}>
              {EXPORT_LABELS[f]}
            </option>
          ))}
        </select>
      </label>
      {!captions && (
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={timestamps} onChange={(e) => setTimestamps(e.target.checked)} aria-label="Include timestamps" />
          Timestamps
        </label>
      )}
      <a href={href} download className="rounded-md bg-[var(--gold-400)] px-2.5 py-1 font-medium text-black">
        Download transcript
      </a>
    </div>
  );
}

export function TalkTime({ rows }: { rows: readonly OverlayRow[] }) {
  const stats = useMemo(() => talkStats(rows), [rows]);
  if (!stats.speakers.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5" data-talk-time>
      <ul className="flex flex-col gap-1.5" aria-label="Talk time by speaker">
        {stats.speakers.map((s) => (
          <li key={s.speaker} className="text-xs">
            <div className="flex justify-between gap-2">
              <span className="truncate text-[var(--fg-primary)]">{s.speaker}</span>
              <span className="shrink-0 tabular-nums text-[var(--fg-muted)]">
                {Math.round(s.share * 100)}% · {durationLabel(s.ms)} · {s.turns} turn{s.turns === 1 ? "" : "s"}
                {s.questions ? ` · ${s.questions} question${s.questions === 1 ? "" : "s"}` : ""}
              </span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-[var(--surface-3)]" aria-hidden>
              <div className="h-full rounded bg-[var(--gold-400)]" style={{ width: `${Math.max(2, Math.round(s.share * 100))}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {stats.monologue && (
        <p className="text-[11px] text-[var(--fg-muted)]">
          Longest stretch: {stats.monologue.speaker}, {durationLabel(stats.monologue.ms)} without a break.
        </p>
      )}
      <p className="text-[11px] text-[var(--fg-muted)]">Estimated from when each line was said.</p>
    </div>
  );
}

function SpeakerNames({
  speakers,
  names,
  onRename,
}: {
  speakers: readonly string[];
  names: ReadonlyMap<string, string>;
  onRename: (original: string, display: string | null) => Promise<string | null>;
}) {
  return (
    <div className="mt-2 flex flex-col gap-1.5" data-speaker-names>
      <p className="text-[11px] text-[var(--fg-muted)]">The new name shows everywhere in this transcript and its downloads. Clear it to go back.</p>
      <ul className="flex flex-col gap-1.5">
        {speakers.map((s) => (
          <SpeakerNameRow key={s} original={s} current={names.get(s) ?? ""} onRename={onRename} />
        ))}
      </ul>
    </div>
  );
}

function SpeakerNameRow({
  original,
  current,
  onRename,
}: {
  original: string;
  current: string;
  onRename: (original: string, display: string | null) => Promise<string | null>;
}) {
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = value.trim() !== current;
  async function save() {
    setBusy(true);
    setError(null);
    const err = await onRename(original, value.trim() || null);
    setBusy(false);
    if (err) setError(err);
  }
  return (
    <li className="flex flex-wrap items-center gap-2 text-xs">
      <span className="w-28 truncate text-[var(--fg-muted)]" title={original}>
        {original}
      </span>
      <input
        value={value}
        maxLength={80}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && dirty) void save();
        }}
        placeholder="Name"
        aria-label={`Name for ${original}`}
        className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--surface-0)] px-2 py-1 text-xs text-[var(--fg-primary)]"
      />
      <button type="button" className={button} disabled={!dirty || busy} onClick={() => void save()}>
        {busy ? "Saving…" : "Save"}
      </button>
      {error && (
        <span role="alert" className="w-full text-[var(--status-danger,#ef4444)]">
          {error}
        </span>
      )}
    </li>
  );
}

/**
 * The actions on one line: copy it as a quote, and for the host, correct it.
 * The words as heard stay one click away once corrected.
 */
export function LineActions({
  text,
  speaker,
  atMs,
  lineId,
  original,
  canEdit,
  onEdit,
}: {
  text: string;
  speaker: string;
  /** Where this line sits on the recording's clock, when there is one. */
  atMs: number | null;
  lineId: string | null;
  /** The words as heard, when this line has been corrected. */
  original: string | null;
  canEdit: boolean;
  onEdit: (lineId: string, text: string | null) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function copy() {
    const url = atMs !== null && typeof window !== "undefined" ? momentUrl(window.location.href, atMs) : null;
    try {
      await navigator.clipboard.writeText(quoteFor({ speaker, text, atMs, url }));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  async function save(next: string | null) {
    if (!lineId) return;
    setBusy(true);
    setError(null);
    const err = await onEdit(lineId, next);
    setBusy(false);
    if (err) setError(err);
    else setEditing(false);
  }

  if (editing && lineId) {
    // Spans, not divs: this sits inside the line's paragraph.
    return (
      <span className="mt-1 flex flex-col gap-1.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.min(6, Math.max(2, Math.ceil(draft.length / 80)))}
          aria-label="Corrected line"
          className="w-full rounded-md border border-[var(--line)] bg-[var(--surface-0)] px-2 py-1.5 text-sm text-[var(--fg-primary)]"
        />
        <span className="flex gap-2 text-xs">
          <button type="button" className={button} disabled={busy || !draft.trim()} onClick={() => void save(draft)}>
            {busy ? "Saving…" : "Save correction"}
          </button>
          <button type="button" className={button} onClick={() => { setEditing(false); setDraft(text); setError(null); }}>
            Cancel
          </button>
        </span>
        {error && <span role="alert" className="text-xs text-[var(--status-danger,#ef4444)]">{error}</span>}
      </span>
    );
  }

  return (
    <span className="ml-1 inline-flex items-center gap-1 align-baseline text-[11px] text-[var(--fg-muted)] opacity-70 group-hover:opacity-100 focus-within:opacity-100">
      {original !== null && (
        <span title={`As heard: ${original}`} className="rounded px-1 ring-1 ring-[var(--line)]">
          edited
        </span>
      )}
      <button type="button" onClick={() => void copy()} className="hover:text-[var(--fg-primary)]" aria-label="Copy as quote">
        {copied ? "Copied" : "Quote"}
      </button>
      {canEdit && lineId && (
        <>
          <button type="button" onClick={() => { setDraft(text); setEditing(true); }} className="hover:text-[var(--fg-primary)]" aria-label="Correct this line">
            Edit
          </button>
          {original !== null && (
            <button type="button" disabled={busy} onClick={() => void save(null)} className="hover:text-[var(--fg-primary)]" aria-label="Undo correction">
              Undo
            </button>
          )}
        </>
      )}
      {error && <span role="alert" className="text-[var(--status-danger,#ef4444)]">{error}</span>}
    </span>
  );
}
