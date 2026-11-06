// lib/meetings/notetaker.server.ts
// The notetaker's reads and its one model call: the live notes.
//
// The routes have already decided who is asking; everything here takes the
// client they chose (the service role, after authorisation) and a meeting id.

import type Anthropic from "@anthropic-ai/sdk";
import { normalizeNoteList, normalizeNoteText } from "@/lib/meetings/live-notes";
import {
  bookmarksForModel,
  glossaryForModel,
  hostNotesForModel,
  readNotetaker,
  type Bookmark,
  type NotetakerSettings,
} from "@/lib/meetings/notetaker";

type Db = { from: (table: string) => any };

export const LIVE_NOTES_MODEL = process.env.CLAUDE_LIVE_NOTES_MODEL ?? "claude-haiku-4-5-20251001";

export interface LiveNotesState {
  key_points: string[];
  decisions: string[];
  action_items: string[];
  summary: string;
  /** When these were written, ms since epoch. */
  generatedAt: number | null;
  /** How many transcript lines they were written from. */
  lines: number;
}

export const EMPTY_LIVE_NOTES: LiveNotesState = {
  key_points: [],
  decisions: [],
  action_items: [],
  summary: "",
  generatedAt: null,
  lines: 0,
};

export function readLiveNotes(raw: unknown): LiveNotesState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_LIVE_NOTES };
  const o = raw as Record<string, unknown>;
  const at = Number(o.generatedAt);
  const lines = Number(o.lines);
  return {
    key_points: normalizeNoteList(o.key_points, 12),
    decisions: normalizeNoteList(o.decisions, 12),
    action_items: normalizeNoteList(o.action_items, 12),
    summary: normalizeNoteText(o.summary),
    generatedAt: Number.isFinite(at) && at > 0 ? at : null,
    lines: Number.isFinite(lines) && lines > 0 ? Math.floor(lines) : 0,
  };
}

export interface NotetakerMeeting {
  id: string;
  title: string;
  hostId: string | null;
  organizationId: string | null;
  status: string | null;
  startedAt: string | null;
  settings: NotetakerSettings;
  liveNotes: LiveNotesState;
}

/**
 * The meeting as the notetaker needs it. `missing` when the columns this
 * feature adds are not there yet — the code can deploy before its migration.
 */
export async function loadNotetakerMeeting(
  db: Db,
  meetingId: string,
): Promise<{ meeting: NotetakerMeeting } | { missing: true } | { notFound: true }> {
  const { data, error } = await db
    .from("live_meetings")
    .select("id, title, host_id, organization_id, status, started_at, notetaker, live_notes")
    .eq("id", meetingId)
    .maybeSingle();
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42703" || code === "PGRST204") return { missing: true };
    return { notFound: true };
  }
  if (!data) return { notFound: true };
  const row = data as Record<string, unknown>;
  return {
    meeting: {
      id: String(row.id),
      title: typeof row.title === "string" ? row.title : "",
      hostId: (row.host_id as string | null) ?? null,
      organizationId: (row.organization_id as string | null) ?? null,
      status: (row.status as string | null) ?? null,
      startedAt: (row.started_at as string | null) ?? null,
      settings: readNotetaker(row.notetaker),
      liveNotes: readLiveNotes(row.live_notes),
    },
  };
}

/** The firm's glossary, or none when it cannot be read. */
export async function loadGlossary(db: Db, organizationId: string | null): Promise<string[]> {
  if (!organizationId) return [];
  try {
    const { data, error } = await db
      .from("meeting_glossary_terms")
      .select("term")
      .eq("organization_id", organizationId)
      .order("term", { ascending: true })
      .limit(200);
    if (error || !Array.isArray(data)) return [];
    return (data as Array<{ term: unknown }>).map((r) => (typeof r.term === "string" ? r.term : "")).filter(Boolean);
  } catch {
    return [];
  }
}

/** Every bookmark in a meeting with who made it, oldest first; none when unreadable. */
export async function loadMeetingBookmarks(db: Db, meetingId: string): Promise<Bookmark[]> {
  try {
    const { data, error } = await db
      .from("live_meeting_bookmarks")
      .select("id, at, label, user_id")
      .eq("meeting_id", meetingId)
      .order("at", { ascending: true })
      .limit(100);
    if (error || !Array.isArray(data)) return [];
    const rows = data as Array<{ id: string; at: string; label: string | null; user_id: string }>;
    const ids = [...new Set(rows.map((r) => r.user_id))];
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: people } = await db.from("principals").select("id, full_name").in("id", ids);
      for (const p of (people ?? []) as Array<{ id: string; full_name: string | null }>) {
        if (p.full_name) names.set(p.id, p.full_name);
      }
    }
    return rows.map((r) => ({ id: r.id, at: r.at, label: r.label, by: names.get(r.user_id) ?? null }));
  } catch {
    return [];
  }
}

/** The host's own notes for a meeting, or "" when there are none or they cannot be read. */
export async function loadHostNotes(db: Db, meetingId: string, hostId: string | null): Promise<string> {
  if (!hostId) return "";
  try {
    const { data } = await db
      .from("live_meeting_notes")
      .select("body")
      .eq("meeting_id", meetingId)
      .eq("user_id", hostId)
      .maybeSingle();
    return typeof (data as { body?: unknown } | null)?.body === "string" ? (data as { body: string }).body : "";
  } catch {
    return "";
  }
}

const SYSTEM = [
  "You keep running notes for a meeting that is still happening.",
  "You are given the transcript so far. Write short, factual notes a person could glance at mid-call.",
  "Only include what was actually said. Never invent owners, numbers or dates.",
  "Key points: the main things discussed. Decisions: only what was clearly agreed.",
  "Action items: who will do what, as said; use the speaker's name when one is clear.",
  "Summary: two sentences at most on where the conversation is right now.",
].join(" ");

const LIVE_NOTES_SCHEMA = {
  type: "object" as const,
  properties: {
    summary: { type: "string", description: "Where the meeting is right now, two sentences at most." },
    key_points: { type: "array", items: { type: "string" }, description: "Up to 8 short points." },
    decisions: { type: "array", items: { type: "string" }, description: "Only what was agreed." },
    action_items: { type: "array", items: { type: "string" }, description: "Owner: task, as said." },
  },
  required: ["summary", "key_points", "decisions", "action_items"],
};

/** The most of the transcript the live notes are written from: the end of it. */
export const LIVE_NOTES_MAX_CHARS = 60_000;

export async function generateLiveNotes(
  client: Anthropic,
  model: string,
  input: { title: string; transcript: string; glossary: string; previous: LiveNotesState },
): Promise<Pick<LiveNotesState, "key_points" | "decisions" | "action_items" | "summary">> {
  const transcript =
    input.transcript.length > LIVE_NOTES_MAX_CHARS
      ? `[earlier discussion omitted]\n${input.transcript.slice(-LIVE_NOTES_MAX_CHARS)}`
      : input.transcript;
  const parts = [`Meeting: ${input.title || "Untitled"}`];
  if (input.glossary) parts.push(input.glossary);
  if (input.previous.summary || input.previous.key_points.length) {
    parts.push(
      `Your previous notes (keep what still holds, add what is new):\n${JSON.stringify({
        summary: input.previous.summary,
        key_points: input.previous.key_points,
        decisions: input.previous.decisions,
        action_items: input.previous.action_items,
      })}`,
    );
  }
  parts.push(`Transcript so far:\n${transcript}`);

  const msg = await client.messages.create({
    model,
    max_tokens: 1200,
    system: SYSTEM,
    messages: [{ role: "user", content: parts.join("\n\n") }],
    tools: [{ name: "live_notes", description: "Running notes for the meeting", input_schema: LIVE_NOTES_SCHEMA }],
    tool_choice: { type: "tool", name: "live_notes" },
  });
  const tool = msg.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") throw new Error("no notes returned");
  const raw = tool.input as Record<string, unknown>;
  return {
    summary: normalizeNoteText(raw.summary),
    key_points: normalizeNoteList(raw.key_points, 12),
    decisions: normalizeNoteList(raw.decisions, 12),
    action_items: normalizeNoteList(raw.action_items, 12),
  };
}

/**
 * Everything the notetaker gathered beside the transcript, for the report
 * model: the firm's glossary, the host's notes and the bookmarks. Each part is
 * read softly — a table that is not there yet, or a read that fails, leaves
 * that part out rather than the report.
 */
export async function loadNotetakerForReport(
  db: Db,
  meeting: { id: string; host_id: string | null; organization_id: string | null; started_at: string | null },
): Promise<{ text: string; glossary: string[] }> {
  const [glossary, hostNotes, bookmarks] = await Promise.all([
    loadGlossary(db, meeting.organization_id),
    loadHostNotes(db, meeting.id, meeting.host_id),
    loadMeetingBookmarks(db, meeting.id),
  ]);
  const text = [glossaryForModel(glossary), hostNotesForModel(hostNotes), bookmarksForModel(bookmarks, meeting.started_at)]
    .filter(Boolean)
    .join("\n\n");
  return { text, glossary };
}
