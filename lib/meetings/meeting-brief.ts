// lib/meetings/meeting-brief.ts
// What a meeting was set up to do, for the report model: the objective and
// agenda the host wrote when scheduling it, and the description — which, for a
// meeting booked through a scheduling link, carries the booker's answers to the
// meeting type's questions and their note.
//
// The transcript says what happened; this says what was meant to. A report
// that knows the meeting was "to agree the LPA side letter" can say whether it
// did.
//
// Pure: no React, no Supabase.

/** The most of the brief the prompt carries. It frames the transcript; it is not one. */
export const BRIEF_MAX = 4000;

export interface MeetingBriefRow {
  objective?: string | null;
  agenda?: string | null;
  description?: string | null;
}

function clean(v: string | null | undefined): string {
  return (v ?? "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The brief as prompt text: labelled parts, empty ones left out, trimmed to the
 * budget. Empty when the meeting carries none of it.
 *
 * The stock line a booked meeting's description opens with says nothing about
 * the meeting, so it is dropped.
 */
export function meetingBrief(row: MeetingBriefRow | null | undefined): string {
  if (!row) return "";
  const description = clean(row.description).replace(/^Booked via scheduling link\.\s*/i, "").trim();
  const parts = [
    ["Objective", clean(row.objective)],
    ["Agenda", clean(row.agenda)],
    ["Details", description],
  ]
    .filter(([, text]) => text)
    .map(([label, text]) => (text.includes("\n") ? `${label}:\n${text}` : `${label}: ${text}`));
  const out = parts.join("\n");
  return out.length > BRIEF_MAX ? `${out.slice(0, BRIEF_MAX - 1).trimEnd()}…` : out;
}
