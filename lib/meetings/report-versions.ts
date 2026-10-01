// lib/meetings/report-versions.ts
// A meeting's reports, as versions the host can correct and go back to.
//
// Every report a meeting has had is already kept: the end-of-meeting route and
// the regenerate route both INSERT, and readers take the newest row. What was
// missing was any way to see the older rows, to say what was wrong with one
// before asking for the next, or to go back when the next was worse.
//
// The facts about a version that are not the model's — the correction it was
// asked for, the version it restores — ride on `analysis`, next to
// `report_truncated`, rather than in columns of their own. They are read by this
// feature alone, and keeping them on the blob means a report row is the same
// shape whether or not a migration has reached the database yet.
//
// Pure: no database, no DOM.
import { normalizeNoteText } from "@/lib/meetings/live-notes";

/** Longest correction a host may give. A note on a report, not a second transcript. */
export const MAX_CORRECTION_CHARS = 2_000;

/** On `analysis`: what the host said was wrong with the version before. */
export const CORRECTION_KEY = "correction_note";

/** On `analysis`: the id of the older version this row brings back. */
export const RESTORED_FROM_KEY = "restored_from";

/** How many versions the history lists. Far more than any meeting needs. */
export const VERSION_LIMIT = 50;

/** The trimmed, capped correction, or empty when there is none. */
export function cleanCorrection(note: unknown): string {
  if (typeof note !== "string") return "";
  const text = note.trim();
  return text.length > MAX_CORRECTION_CHARS ? text.slice(0, MAX_CORRECTION_CHARS).trimEnd() : text;
}

/** A stored report row, as the history reads it. */
export interface StoredReportVersion {
  id: string;
  created_at: string;
  summary: string | null;
  analysis: unknown;
}

/** One version, as the history panel shows it. */
export interface ReportVersion {
  id: string;
  createdAt: string;
  summary: string;
  followUp: string;
  /** What the host asked to be fixed, when this version came from a correction. */
  correction: string | null;
  /** The version this one restores, when it was brought back rather than written. */
  restoredFrom: string | null;
  /** The newest version: the one every reader of the report sees. */
  current: boolean;
}

function analysisOf(row: StoredReportVersion): Record<string, unknown> {
  const a = row.analysis;
  return a && typeof a === "object" && !Array.isArray(a) ? (a as Record<string, unknown>) : {};
}

/** Rows newest first, as versions. The first is the current one. */
export function reportVersions(rows: readonly StoredReportVersion[]): ReportVersion[] {
  return rows.map((row, i) => {
    const analysis = analysisOf(row);
    const restored = analysis[RESTORED_FROM_KEY];
    return {
      id: row.id,
      createdAt: row.created_at,
      summary: normalizeNoteText(row.summary),
      followUp: normalizeNoteText(analysis.follow_up_draft),
      correction: cleanCorrection(analysis[CORRECTION_KEY]) || null,
      restoredFrom: typeof restored === "string" && restored ? restored : null,
      current: i === 0,
    };
  });
}

/**
 * The analysis to store when an older version is brought back.
 *
 * A copy, marked with where it came from. The correction that produced the old
 * version is dropped: it described a fix to the version before THAT one, and
 * carrying it forward would credit the restore with a request nobody made.
 */
export function restoredAnalysis(analysis: unknown, fromId: string): Record<string, unknown> {
  const base =
    analysis && typeof analysis === "object" && !Array.isArray(analysis)
      ? { ...(analysis as Record<string, unknown>) }
      : {};
  delete base[CORRECTION_KEY];
  return { ...base, [RESTORED_FROM_KEY]: fromId };
}
