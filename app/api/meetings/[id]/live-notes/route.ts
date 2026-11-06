// app/api/meetings/[id]/live-notes/route.ts
// Notes that build up while the meeting runs: key points, decisions, action
// items and where the conversation is now.
//
// One copy per meeting, stored on the meeting, so a room of ten makes one
// model call a minute rather than ten. GET reads it; POST asks for a fresh
// version, which is written only when enough has been said since the last
// (liveNotesDue) — anyone asking sooner gets the stored one back.
import { NextRequest, NextResponse } from "next/server";
import { anthropicClient, INTERACTIVE_TIMEOUT_MS } from "@/lib/anthropic-client";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { authorizeMeetingCaller } from "@/lib/meetings/meeting-access.server";
import { checkRateLimit } from "@/lib/rate-limit";
import { applyGlossary, canSeeLiveNotes, glossaryForModel, liveNotesDue } from "@/lib/meetings/notetaker";
import {
  EMPTY_LIVE_NOTES,
  LIVE_NOTES_MODEL,
  generateLiveNotes,
  loadGlossary,
  loadNotetakerMeeting,
  type NotetakerMeeting,
} from "@/lib/meetings/notetaker.server";
import { readStoredTranscriptRows } from "@/lib/meetings/report-generation.server";
import { restoreTranscript } from "@/lib/meetings/transcript-restore";
import { transcriptForModel } from "@/lib/meetings/transcript-quality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type Db = { from: (table: string) => any };

async function db(): Promise<Db> {
  return hasSupabaseServiceEnv() ? (createServiceClient() as Db) : ((await createServerClient()) as Db);
}

type Access =
  | { ok: false; response: NextResponse }
  | { ok: true; client: Db; meeting: NotetakerMeeting; isHost: boolean };

async function access(req: NextRequest, id: string): Promise<Access> {
  const caller = await authorizeMeetingCaller(req, id);
  if (!caller.ok) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const client = await db();
  const loaded = await loadNotetakerMeeting(client, id);
  if ("missing" in loaded) return { ok: false, response: NextResponse.json({ notes: EMPTY_LIVE_NOTES, available: false }) };
  if ("notFound" in loaded) return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const isHost = Boolean(caller.userId && caller.userId === loaded.meeting.hostId);
  if (!canSeeLiveNotes(loaded.meeting.settings, isHost)) {
    return { ok: false, response: NextResponse.json({ error: "The host is keeping the live notes to themselves." }, { status: 403 }) };
  }
  return { ok: true, client, meeting: loaded.meeting, isHost };
}

export async function GET(req: NextRequest, { params }: { params: Params }): Promise<NextResponse> {
  const { id } = await params;
  const a = await access(req, id);
  if (!a.ok) return a.response;
  return NextResponse.json({ notes: a.meeting.liveNotes, available: true, paused: a.meeting.settings.paused });
}

export async function POST(req: NextRequest, { params }: { params: Params }): Promise<NextResponse> {
  const { id } = await params;
  const a = await access(req, id);
  if (!a.ok) return a.response;
  const { client, meeting } = a;
  if (meeting.settings.paused) return NextResponse.json({ notes: meeting.liveNotes, available: true, paused: true });
  if (meeting.status === "ended") return NextResponse.json({ notes: meeting.liveNotes, available: true, ended: true });

  const body = (await req.json().catch(() => ({}))) as { force?: unknown };
  const force = body.force === true;
  const rows = await readStoredTranscriptRows(client as never, id);
  const now = Date.now();
  const due = liveNotesDue({ lines: rows.length, lastLines: meeting.liveNotes.lines, lastAt: meeting.liveNotes.generatedAt }, now, force);
  // One writer per meeting at a time on this instance; the stored timestamp
  // holds the line between instances.
  const gate = due ? checkRateLimit({ key: `live-notes:${id}`, limit: 1, windowMs: 15_000 }) : null;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!due || !gate?.ok || !apiKey) {
    return NextResponse.json({ notes: meeting.liveNotes, available: true, fresh: false });
  }

  const glossary = await loadGlossary(client, meeting.organizationId);
  const transcript = applyGlossary(transcriptForModel(restoreTranscript(rows)), glossary);
  try {
    const written = await generateLiveNotes(anthropicClient(apiKey, INTERACTIVE_TIMEOUT_MS), LIVE_NOTES_MODEL, {
      title: meeting.title,
      transcript,
      glossary: glossaryForModel(glossary),
      previous: meeting.liveNotes,
    });
    const notes = { ...written, generatedAt: now, lines: rows.length };
    await client.from("live_meetings").update({ live_notes: notes }).eq("id", id);
    return NextResponse.json({ notes, available: true, fresh: true });
  } catch (err) {
    console.warn("[/api/meetings/[id]/live-notes] could not write notes", err);
    return NextResponse.json({ notes: meeting.liveNotes, available: true, fresh: false, error: "Couldn't update the notes just now." });
  }
}
