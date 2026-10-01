// lib/meetings/doc-share.server.ts
// The reads and the one write behind sharing a data-room document from a call.
//
// Kept apart from `doc-share.ts` for the usual reason: that module is pure and
// is imported by the in-call panel, which is a client component. This one
// touches the database and mints links.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { insertShare, shareUrl } from "@/lib/data-room-shares.server";
import { shareState } from "@/lib/data-rooms";
import type { Database } from "@/lib/supabase/database.types";
import {
  DOC_SHARE_EXPIRY_DAYS,
  DOC_SHARE_MAX_LIST,
  docShareLabel,
  shareableDocuments,
  type MeetingDoc,
} from "@/lib/meetings/doc-share";

// `live_meeting_shared_documents` is newer than the generated types, so the
// writes against it go through a structural stand-in rather than a cast per
// call. Same shape the chat route uses for the same reason.
type SupabaseLike = { from: (table: string) => any };

/** A document already handed over in this meeting. */
export interface SharedDoc {
  documentId: string;
  /** The link, ready to paste. */
  url: string;
  sharedAt: string;
}

export interface MeetingDocList {
  docs: MeetingDoc[];
  /**
   * The firm has more published documents than the picker was allowed to load.
   *
   * Reported rather than swallowed: a host who cannot find a document has to be
   * able to tell "it is not published" from "it is past the bound", and those
   * two look identical in a list that silently stops.
   */
  truncated: boolean;
}

/**
 * Every document the firm could hand over, across all its live rooms.
 *
 * Three reads rather than `loadRoomDocuments` per room. That helper takes a
 * single room and makes two queries, so a firm with six rooms would have cost
 * twelve round trips to build one panel — inside a live call, competing with
 * the video for the same main thread. The manifest for every room comes back in
 * one query and the documents in one more.
 *
 * Scoped by `organization_id` on every clause as well as by RLS. The redundancy
 * is deliberate: this is reached from a meeting, and the meeting's org is
 * established by `authorizeMeetingMember`, so the predicate states which org's
 * materials are in play instead of leaving it to be inferred from the session.
 */
export async function loadMeetingDocs(orgId: string): Promise<MeetingDocList> {
  const supabase = await createServerClient();

  const [{ data: roomRows }, { data: entryRows }] = await Promise.all([
    supabase
      .from("data_rooms")
      .select("id, name, is_default")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      // Default first, then creation order: `shareableDocuments` uses exactly
      // this order to decide which room a document shared from several rooms is
      // attributed to, so the ordering is load-bearing, not cosmetic.
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("data_room_documents")
      .select("room_id, document_id, sort_order")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true })
      // One over the bound, so "there are more" is a fact about the data rather
      // than a guess from a full page.
      .limit(DOC_SHARE_MAX_LIST + 1),
  ]);

  const rooms = ((roomRows ?? []) as { id: string; name: string; is_default: boolean }[]).map((r) => ({
    id: r.id,
    name: r.name,
    isDefault: r.is_default,
  }));

  const allEntries = (entryRows ?? []) as { room_id: string; document_id: string; sort_order: number }[];
  const truncated = allEntries.length > DOC_SHARE_MAX_LIST;
  const entries = allEntries.slice(0, DOC_SHARE_MAX_LIST).map((e) => ({
    roomId: e.room_id,
    documentId: e.document_id,
    sortOrder: e.sort_order ?? 0,
  }));

  if (entries.length === 0) return { docs: [], truncated };

  const { data: docRows } = await supabase
    .from("documents")
    .select("id, name, doc_type, status, storage_key, content")
    .eq("organization_id", orgId)
    .in("id", [...new Set(entries.map((e) => e.documentId))]);

  const documents = ((docRows ?? []) as {
    id: string;
    name: string;
    doc_type: string | null;
    status: string | null;
    storage_key: string | null;
    content: string | null;
  }[]).map((d) => ({
    id: d.id,
    name: d.name,
    section: d.doc_type,
    status: d.status,
    hasFile: Boolean(d.storage_key),
    hasContent: Boolean(d.content && d.content.trim()),
  }));

  return { docs: shareableDocuments({ rooms, entries, documents }), truncated };
}

/** A join row with the state of the link it points at. */
interface SharedRow {
  /** The join row's own id, so an inactive one can be repointed rather than replaced. */
  id: string;
  documentId: string;
  url: string;
  sharedAt: string;
  /** Whether the link it names still opens. */
  live: boolean;
}

/**
 * Every join row for this meeting, with whether its link is still live.
 *
 * `revoked_at` and `expires_at` are read, not ignored, and that is the whole
 * point of this shape. A link minted here carries a 14-day expiry by design and
 * can be revoked from the Shares panel at any moment. Treating a dead row as
 * the meeting's current link had two consequences and the second is the bad
 * one: the panel offered "Send again" on a URL that does not open, AND the
 * unique index on (meeting_id, document_id) then refused every attempt to mint
 * a working replacement. The host could not share that document in that meeting
 * again, ever.
 *
 * `shareState` rather than a second reading of the two columns — it is what the
 * Shares list and the viewer already use, and a link this says is live while
 * the room says it is expired is the kind of disagreement nobody debugs twice.
 */
async function readSharedRows(meetingId: string, now: number): Promise<SharedRow[]> {
  const supabase = (await createServerClient()) as SupabaseLike;
  const { data } = await supabase
    .from("live_meeting_shared_documents")
    .select("id, document_id, created_at, data_room_shares!inner(token, expires_at, revoked_at)")
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: true });

  type Embedded = { token: string; expires_at: string | null; revoked_at: string | null };
  const rows = (data ?? []) as {
    id: string;
    document_id: string;
    created_at: string;
    data_room_shares: Embedded | Embedded[] | null;
  }[];

  return rows.flatMap((row) => {
    // The embed comes back as an object for a to-one relation and as an array
    // when the planner cannot prove it is to-one. Both are handled rather than
    // one assumed, because the wrong assumption here is an empty panel with no
    // error anywhere.
    const share = Array.isArray(row.data_room_shares) ? row.data_room_shares[0] : row.data_room_shares;
    if (!share?.token) return [];
    const state = shareState(
      { label: null, allowed_sections: null, expires_at: share.expires_at, revoked_at: share.revoked_at },
      now,
    );
    return [{
      id: row.id,
      documentId: row.document_id,
      url: shareUrl(share.token),
      sharedAt: row.created_at,
      live: state === "active",
    }];
  });
}

/**
 * What has already been handed over in this meeting and is still openable,
 * oldest first.
 *
 * A dead link is deliberately absent rather than listed as dead. The panel's
 * only use for this list is to offer "Send again", and offering that on a URL
 * that will not open is worse than showing the document as unshared — which is
 * what it effectively is.
 */
export async function loadSharedInMeeting(
  meetingId: string,
  now: number = Date.now(),
): Promise<SharedDoc[]> {
  const rows = await readSharedRows(meetingId, now);
  return rows
    .filter((r) => r.live)
    .map((r) => ({ documentId: r.documentId, url: r.url, sharedAt: r.sharedAt }));
}

export type ShareOutcome =
  | { ok: true; url: string; documentName: string; alreadyShared: boolean }
  | { ok: false; reason: "not-shareable" | "mint-failed" | "record-failed" };

/**
 * Hand one document over, or hand back the link already minted for it.
 *
 * The idempotency is checked first and enforced second. Reading the join row
 * before minting makes the common double-tap cheap; the unique index on
 * (meeting_id, document_id) is what makes it CORRECT, because two co-hosts
 * sharing the same deck at the same moment both read nothing and both mint.
 * The loser of that race re-reads and returns the winner's link, and its own
 * share row is revoked rather than left live — an unreferenced link to the
 * firm's materials is exactly the kind of thing nobody ever goes back and
 * cleans up.
 *
 * THE GATES, AND WHY THEY ARE WHAT THEY ARE. A link composed deliberately in
 * the Share panel can ask for an email, an NDA and a password. A link handed
 * over mid-sentence cannot:
 *
 *   no password     — there is nobody to tell it to without saying it out loud
 *                     on a call that may be recorded and transcribed;
 *   no NDA gate     — it would stop the person you are talking to from opening
 *                     the document while you are talking about it, which is the
 *                     entire thing this feature exists to make possible;
 *   email capture   — ON, because it costs the reader one field and it is what
 *                     makes the audit log name a person rather than a token;
 *   watermark       — ON, because the document is leaving the room and the
 *                     watermark is what makes a leak attributable. With email
 *                     capture on it names the reader, which is the only form of
 *                     it worth having;
 *   download        — ON. A view-only link is a reasonable default for a cold
 *                     outreach and the wrong one here: you are on a call with
 *                     this person and they asked for the document.
 *
 * None of this is a ceiling. The share is an ordinary row, so the Shares panel
 * can tighten, extend or revoke it afterwards like any other — and the firm
 * that wants different defaults has a place to change them rather than a
 * behaviour to discover.
 */
export async function shareDocumentInMeeting(input: {
  meetingId: string;
  meetingTitle: string | null;
  orgId: string;
  userId: string;
  documentId: string;
  now?: number;
}): Promise<ShareOutcome> {
  const now = input.now ?? Date.now();
  const authed = await createServerClient();

  // THE SERVICE ROLE, for the join row only.
  //
  // `live_meeting_shared_documents` has RLS on and a SELECT policy and nothing
  // else — deliberately, as its migration says, because writes come through
  // this path after `authorizeMeetingMember` has established who is asking.
  // This function was then written against the RLS-bound client, so every
  // insert was refused by the absent INSERT policy: the link minted, the row
  // did not record, and the caller got `record-failed` on the happy path. The
  // feature did not work at all.
  //
  // `insertShare` keeps the AUTHED client on purpose. The share itself has a
  // real write policy (`is_org_writer`), and that is the check that stops a
  // reader-role member handing out the firm's materials. Running it as the
  // service role would quietly delete that check.
  const svc = (hasSupabaseServiceEnv()
    ? createServiceClient()
    : (authed as unknown)) as SupabaseLike;
  /**
   * The caller's own client, for everything that has a policy of its own.
   *
   * `data_room_shares` carries `is_org_writer`, and the member has just minted
   * through it, so revoking a share they created needs no elevation. The
   * service role is used for exactly one table and no more: widening it to
   * every write here would be the kind of convenience that removes a check
   * nobody notices is gone.
   */
  const authedLike = authed as unknown as SupabaseLike;

  // Both reads at once. They are independent, and this runs on a tap during a
  // live call, where two round trips in series are two the host waits through.
  const [rows, { docs }] = await Promise.all([
    readSharedRows(input.meetingId, now),
    loadMeetingDocs(input.orgId),
  ]);
  const held = rows.find((s) => s.documentId === input.documentId);

  // The document still has to be offerable, even when a link already exists:
  // a document that has since been unpublished or reverted to draft should not
  // be re-announced in the room just because it was shared earlier.
  const doc = docs.find((d) => d.id === input.documentId);
  if (!doc || doc.blocked) return { ok: false, reason: "not-shareable" };

  if (held?.live) return { ok: true, url: held.url, documentName: doc.name, alreadyShared: true };

  const minted = await insertShare(authed as SupabaseClient<Database>, {
    orgId: input.orgId,
    userId: input.userId,
    roomId: doc.roomId,
    documentId: doc.id,
    label: docShareLabel(input.meetingTitle),
    expiresInDays: DOC_SHARE_EXPIRY_DAYS,
    requireEmail: true,
    requireNda: false,
    ndaText: null,
    password: null,
    // No recipient: `insertShare` emails the link when one is named, and the
    // link is about to be said in the room. An email as well would be a second
    // copy with a different arrival time, to an address nobody supplied.
    recipientEmail: null,
    notifyOnOpen: false,
    allowedSections: null,
    allowDownload: true,
    watermark: true,
  });

  // Null covers both the write policy refusing a reader-role member and an
  // ordinary insert failure. Either way no link exists, which is the only
  // thing the caller can act on.
  if (!minted) return { ok: false, reason: "mint-failed" };

  // REPOINT, rather than insert, when a row is already here holding a dead
  // link. The unique index on (meeting_id, document_id) is what makes a double
  // tap safe, and it is also what would make a revoked or expired link
  // permanent: an insert cannot win against that row, so without this branch
  // the host could never share that document in this meeting again. Updating
  // the row keeps the index's guarantee — still one row per document per
  // meeting — while letting the link behind it be replaced.
  //
  // `created_at` is left alone: it records when this document first went to
  // this call, which is the question the meeting's record is asked. `shared_by`
  // moves to whoever re-shared it, because they are the person who handed the
  // live link over.
  const { error } = held
    ? await svc
        .from("live_meeting_shared_documents")
        .update({ share_id: minted.id, shared_by: input.userId })
        .eq("id", held.id)
    : await svc.from("live_meeting_shared_documents").insert({
        meeting_id: input.meetingId,
        organization_id: input.orgId,
        document_id: doc.id,
        room_id: doc.roomId,
        share_id: minted.id,
        shared_by: input.userId,
      });

  if (error) {
    // Whatever went wrong, the link we just minted is now unreferenced, and an
    // unreferenced live link to the firm's materials is precisely the thing
    // nobody ever comes back and cleans up. It is revoked on both paths out of
    // here, before either of them returns.
    await authedLike
      .from("data_room_shares")
      .update({ revoked_at: new Date(now).toISOString() })
      .eq("id", minted.id);

    // The unique index is the expected way to land here: somebody else shared
    // this document in this meeting between our read and our insert. Their link
    // is the one the room should see, so theirs is returned.
    const raced = await loadSharedInMeeting(input.meetingId, now);
    const winner = raced.find((s) => s.documentId === input.documentId);
    if (winner) return { ok: true, url: winner.url, documentName: doc.name, alreadyShared: true };

    // Not a race: nothing records which call this link came from, and nothing
    // ever will. Reported as a failure, because the caller is about to announce
    // it in the room and a link the firm has no record of issuing is worse than
    // asking the host to tap again.
    console.error("[doc-share] could not record the share", error.message);
    return { ok: false, reason: "record-failed" };
  }

  return { ok: true, url: shareUrl(minted.token), documentName: doc.name, alreadyShared: false };
}
