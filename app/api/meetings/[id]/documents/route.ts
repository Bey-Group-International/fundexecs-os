// app/api/meetings/[id]/documents/route.ts
// The in-call document picker, and the one tap that hands a document over.
//
// GET lists what the firm could share; POST mints (or re-reads) the link for
// one of them. Both are MEMBER-ONLY, which is the difference from every other
// route under this path: the transcript, the chat and the reactions all serve
// an admitted guest, because a guest is who they are about. This one reaches
// into the firm's data room, so it serves only a signed-in member of the
// meeting's organization -- see `authorizeMeetingMember` for why a participant
// row is not enough.
//
// Nothing here delivers the link. The room announces it through the ordinary
// chat path, so the message is broadcast to live peers, stored, ordered by the
// server's clock, deduped on the sender's id, linkified, and carried into the
// report and the export -- all of which already work. A delivery mechanism of
// its own would have had to be taught to each of those, and the ones it was
// not taught would have rendered the most important message in the call as an
// empty bubble.
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { authorizeMeetingMember } from "@/lib/meetings/meeting-access.server";
import { createServerClient } from "@/lib/supabase/server";
import { loadMeetingDocs, loadSharedInMeeting, shareDocumentInMeeting } from "@/lib/meetings/doc-share.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Minting a link is a write against the firm's materials, so this is far below
 * the chat's allowance. A host sharing more than a dozen documents in a minute
 * is not a host; twenty leaves room for a fumbled tap and a retry.
 */
const SHARE_LIMIT = 20;
const SHARE_WINDOW_MS = 60_000;

type Params = Promise<{ id: string }>;

/** What the firm could hand over, and what it already has. */
export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;

  const member = await authorizeMeetingMember(id);
  if (!member.ok || !member.orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [list, shared] = await Promise.all([
    loadMeetingDocs(member.orgId),
    loadSharedInMeeting(id),
  ]);

  return NextResponse.json({ docs: list.docs, truncated: list.truncated, shared });
}

/** Hand one document over. */
export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params;

  const limit = checkRateLimit({
    key: `meeting-doc-share:${clientIp(req)}`,
    limit: SHARE_LIMIT,
    windowMs: SHARE_WINDOW_MS,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many documents shared at once" },
      { status: 429, headers: rateLimitHeaders(limit, SHARE_LIMIT) },
    );
  }

  const member = await authorizeMeetingMember(id);
  if (!member.ok || !member.orgId || !member.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { documentId?: unknown };
  const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
  if (!documentId) {
    return NextResponse.json({ error: "Which document?" }, { status: 422 });
  }

  // The title from the meeting, never from the request. It becomes the share's
  // label, which reaches the Shares list and the audit export, so a client that
  // supplied it could label the firm's own link anything it liked.
  const supabase = await createServerClient();
  const { data: meetingRow } = await supabase
    .from("live_meetings")
    .select("title")
    .eq("id", id)
    .maybeSingle();
  const meetingTitle = (meetingRow as { title: string | null } | null)?.title ?? null;

  const outcome = await shareDocumentInMeeting({
    meetingId: id,
    meetingTitle,
    orgId: member.orgId,
    userId: member.userId,
    documentId,
  });

  if (!outcome.ok) {
    // Each reason is a different thing for the host to do, so each gets its own
    // status and its own sentence. A single 500 reading "failed" would have the
    // host tapping again at a document that structurally cannot be shared.
    if (outcome.reason === "not-shareable") {
      return NextResponse.json(
        { error: "That document is not published to a data room, or is still a draft." },
        { status: 409 },
      );
    }
    if (outcome.reason === "not-configured") {
      // An operator problem, not the host's. Said plainly rather than dressed
      // up as a permission failure, which would send them looking for a role
      // change that would not help.
      return NextResponse.json(
        { error: "Document sharing is not configured on this deployment. Nothing was shared." },
        { status: 503 },
      );
    }
    if (outcome.reason === "mint-failed") {
      return NextResponse.json(
        { error: "Could not create a link. You may not have permission to share this firm's materials." },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: "Created a link but could not record it against this meeting. Nothing was shared; try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    url: outcome.url,
    documentName: outcome.documentName,
    alreadyShared: outcome.alreadyShared,
  });
}
