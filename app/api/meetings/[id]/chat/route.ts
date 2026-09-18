// app/api/meetings/[id]/chat/route.ts
// Reading and writing a meeting's chat.
//
// This exists for the same reason the transcript route does: the client cannot
// do it. Writes are behind a table whose only sensible policy is keyed on
// `auth.uid()`, and an invite-link GUEST has no session at all — every insert
// they made would be rejected by a policy that cannot fail loudly. So the route
// decides who is asking, and writes with the service role once it has.
//
// GET is the half that was missing entirely. Chat was a broadcast with no
// history, so somebody joining ten minutes into a call saw an empty panel while
// the room talked about what had been said in it.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { authorizeMeetingCaller } from "@/lib/meetings/meeting-access.server";
import { cleanChatText, type ChatMessage } from "@/lib/meetings/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Comfortably above how fast a person types, low enough not to be a write hose. */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

/** Most messages ever handed back as history. A chat is not a mailing list. */
const MAX_HISTORY = 500;

/** The longest a display name may be on its way into the record. */
const MAX_NAME = 80;

type Params = Promise<{ id: string }>;
type SupabaseLike = { from: (table: string) => any };

function writeClient(authed: SupabaseLike): SupabaseLike {
  return hasSupabaseServiceEnv() ? (createServiceClient() as SupabaseLike) : authed;
}

/**
 * The conversation so far.
 *
 * Ordered oldest first, which is the only order a chat is ever read in, and
 * capped: a long meeting's chat is still a chat, and handing back ten thousand
 * rows would be slower than the call.
 */
export async function GET(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;

  const caller = await authorizeMeetingCaller(req, id);
  if (!caller.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const read = writeClient((await createServerClient()) as SupabaseLike);
  const { data, error } = await read
    .from("live_meeting_chat")
    .select("id, author_id, author_name, body, ts")
    .eq("meeting_id", id)
    .order("ts", { ascending: true })
    .limit(MAX_HISTORY);

  if (error) {
    // Losing the history costs a latecomer the conversation so far, not their
    // ability to take part in the rest of it — so this is reported and the
    // room carries on.
    console.error("[/api/meetings/[id]/chat] history unavailable", error.message);
    return NextResponse.json({ messages: [] });
  }

  const rows = (data ?? []) as Array<{
    id: string;
    author_id: string | null;
    author_name: string;
    body: string;
    ts: string;
  }>;

  const messages: ChatMessage[] = rows.map((row) => ({
    id: row.id,
    // The room keys tiles by peer id, which a stored row has no idea about.
    // The account is what survives, and a guest has none.
    from: row.author_id ?? row.id,
    displayName: row.author_name,
    text: row.body,
    ts: Date.parse(row.ts) || 0,
  }));

  return NextResponse.json({ messages });
}

/**
 * Store one message.
 *
 * Idempotent on the sender's own id, so a post that timed out can be retried
 * without saying it twice — which is what makes retrying safe to do at all.
 */
export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;

  const limit = checkRateLimit({
    key: `meeting-chat:${clientIp(req)}`,
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many messages" },
      { status: 429, headers: rateLimitHeaders(limit, RATE_LIMIT) },
    );
  }

  const caller = await authorizeMeetingCaller(req, id);
  if (!caller.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    id?: unknown;
    text?: unknown;
    displayName?: unknown;
    ts?: unknown;
  };

  const messageId = typeof body.id === "string" && body.id.length > 0 && body.id.length <= 64 ? body.id : "";
  const text = cleanChatText(typeof body.text === "string" ? body.text : "");
  const name = (typeof body.displayName === "string" ? body.displayName : "").trim().slice(0, MAX_NAME);
  if (!messageId || !text) {
    return NextResponse.json({ error: "A message needs an id and something to say." }, { status: 422 });
  }

  // The time is the server's. A client clock that is an hour out would
  // otherwise reorder the conversation for everyone who reads it later.
  const ts = new Date().toISOString();

  const write = writeClient((await createServerClient()) as SupabaseLike);
  const { error } = await write.from("live_meeting_chat").upsert(
    {
      id: messageId,
      meeting_id: id,
      // From the session, never the body: this is the field that tells two
      // people with the same display name apart. A guest gets null.
      author_id: caller.userId,
      author_name: name || "Guest",
      body: text,
      ts,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );

  if (error) {
    // A failure here costs the record of the message, not the message: the
    // broadcast has already reached the room. Reported as a failure so the
    // sender can retry, which the shared id makes safe.
    console.error("[/api/meetings/[id]/chat] could not store message", error.message);
    return NextResponse.json({ error: "Failed to save the message" }, { status: 500 });
  }

  return NextResponse.json({ saved: 1, ts });
}
