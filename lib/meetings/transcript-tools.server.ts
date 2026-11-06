// lib/meetings/transcript-tools.server.ts
// Reading a meeting's transcript with its overlay (speaker names and line
// corrections) and writing it out as a Word document. See transcript-tools.ts.
//
// Every read is soft: the overlay tables arrive with a migration that may not
// have run yet, and the transcript must still read without them.

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { readAllTranscriptRows } from "@/lib/meetings/transcript-read";
import { overlayFrom, EMPTY_OVERLAY, type ExportLine, type OverlayRow, type TranscriptOverlay } from "@/lib/meetings/transcript-tools";

type Db = { from: (table: string) => any };

/** A meeting's speaker names and line corrections. Empty when there are none, or no tables yet. */
export async function loadOverlay(db: Db, meetingId: string): Promise<TranscriptOverlay> {
  try {
    const [names, edits] = await Promise.all([
      db.from("live_meeting_speaker_names").select("original, display").eq("meeting_id", meetingId).limit(500),
      db.from("live_meeting_transcript_edits").select("line_id, text").eq("meeting_id", meetingId).limit(5000),
    ]);
    return overlayFrom(names?.error ? [] : names?.data, edits?.error ? [] : edits?.data);
  } catch {
    return EMPTY_OVERLAY;
  }
}

/** Every stored line of a meeting, with ids, oldest first. */
export async function loadTranscriptRows(db: Db, meetingId: string): Promise<OverlayRow[]> {
  const rows = await readAllTranscriptRows((from, to) =>
    db
      .from("live_meeting_transcripts")
      .select("id, speaker, text, ts, confidence, overlapped")
      .eq("meeting_id", meetingId)
      .order("ts", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows as unknown as OverlayRow[];
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** The transcript as a Word document: a title, then one paragraph per turn. */
export async function transcriptDocx(lines: readonly ExportLine[], opts: { title: string; timestamps: boolean }): Promise<Uint8Array> {
  const children: Paragraph[] = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: opts.title, bold: true })] })];
  let last: { speaker: string; para: TextRun[] } | null = null;
  const flush = () => {
    if (last) children.push(new Paragraph({ spacing: { after: 160 }, children: last.para }));
  };
  for (const l of lines) {
    if (last && last.speaker === l.speaker) {
      last.para.push(new TextRun({ text: ` ${l.text}` }));
      continue;
    }
    flush();
    const head: TextRun[] = [new TextRun({ text: l.speaker || "Unattributed", bold: true })];
    if (opts.timestamps) head.push(new TextRun({ text: `  ${clock(l.atMs)}`, color: "888888" }));
    head.push(new TextRun({ text: l.text, break: 1 }));
    last = { speaker: l.speaker, para: head };
  }
  flush();
  const buffer = await Packer.toBuffer(new Document({ sections: [{ children }] }));
  return new Uint8Array(buffer);
}
