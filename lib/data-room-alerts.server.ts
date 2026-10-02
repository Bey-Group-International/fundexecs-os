// lib/data-room-alerts.server.ts
//
// Sending data-room alerts to a link's creator: one email the first time each
// reader opens the link, and a daily digest for links that opt in. Both run on
// the service role — the first from the public viewer, which has no session;
// the digest from the daily cron.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import type { Database } from "@/lib/supabase/database.types";
import { digestEmail, firstOpenEmail, summarizeViews, type LinkDigest, type ViewRow } from "@/lib/data-room-alerts";

type Service = SupabaseClient<Database>;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
export const MAX_NEW_READERS_PER_HOUR = 20;

export function activityUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.fundexecs.com";
  return `${base}/build/data_room`;
}

async function creatorEmail(supabase: Service, userId: string): Promise<string | null> {
  const { data } = await supabase.auth.admin.getUserById(userId).catch(() => ({ data: null }));
  return (data as { user?: { email?: string } } | null)?.user?.email ?? null;
}

export interface OpenedShare {
  id: string;
  organization_id: string;
  room_id: string | null;
  label: string | null;
  notify_on_open: boolean;
  created_by: string | null;
}

/**
 * Record that `viewerKey` opened the link and, the first time only, email the
 * link's creator. The insert is the dedupe: a repeat open conflicts on the
 * primary key and returns no row, so concurrent tabs cannot both send.
 * Returns whether this was the reader's first open.
 */
export async function recordFirstOpen(
  supabase: Service,
  share: OpenedShare,
  viewerKey: string,
  viewerEmail: string | null,
): Promise<boolean> {
  // The viewer is public: anyone holding the link can call this with a fresh
  // browser id each time. Cap new readers per link per hour so a scripted
  // caller cannot turn the creator's inbox into a target.
  const { count } = await supabase
    .from("data_room_open_alerts")
    .select("share_id", { count: "exact", head: true })
    .eq("share_id", share.id)
    .gt("created_at", new Date(Date.now() - HOUR_MS).toISOString());
  if ((count ?? 0) >= MAX_NEW_READERS_PER_HOUR) return false;

  const { data } = await supabase
    .from("data_room_open_alerts")
    .upsert(
      { share_id: share.id, viewer_key: viewerKey, organization_id: share.organization_id, viewer_email: viewerEmail } as never,
      { onConflict: "share_id,viewer_key", ignoreDuplicates: true },
    )
    .select("share_id");
  const first = Array.isArray(data) && data.length > 0;
  if (!first || !share.notify_on_open || !share.created_by) return first;

  const to = await creatorEmail(supabase, share.created_by);
  if (!to) return first;
  const { data: room } = share.room_id
    ? await supabase.from("data_rooms").select("name").eq("id", share.room_id).maybeSingle()
    : { data: null };
  const { subject, html } = firstOpenEmail({
    linkLabel: share.label,
    roomName: (room as { name?: string } | null)?.name ?? null,
    viewerEmail,
    activityUrl: activityUrl(),
  });
  await sendEmail({ orgId: share.organization_id, to: { name: "", email: to }, subject, htmlBody: html }).catch(
    () => undefined,
  );
  return first;
}

interface DigestShare {
  id: string;
  organization_id: string;
  room_id: string | null;
  label: string | null;
  created_by: string | null;
  digest_sent_at: string | null;
  revoked_at: string | null;
}

export interface DigestSummary {
  links: number;
  emails: number;
}

/**
 * The daily sweep: for every link with the digest on, report activity since it
 * was last reported (at most a day back), one email per creator. A link with
 * no activity is skipped and its window is not advanced, so nothing is lost.
 */
export async function sendDataRoomDigests(supabase: Service, now = new Date()): Promise<DigestSummary> {
  const { data } = await supabase
    .from("data_room_shares")
    .select("id, organization_id, room_id, label, created_by, digest_sent_at, revoked_at")
    .eq("daily_digest", true)
    .is("revoked_at", null);
  const shares = (data ?? []) as DigestShare[];

  const byCreator = new Map<string, { orgId: string; items: { share: DigestShare; digest: LinkDigest }[] }>();
  for (const share of shares) {
    if (!share.created_by) continue;
    const floor = now.getTime() - DAY_MS;
    const since = new Date(Math.max(floor, share.digest_sent_at ? new Date(share.digest_sent_at).getTime() : floor));
    const { data: views } = await supabase
      .from("data_room_views")
      .select("viewer_email, session_id, document_id, kind, duration_seconds, created_at")
      .eq("share_id", share.id)
      .gt("created_at", since.toISOString())
      .lte("created_at", now.toISOString())
      .limit(5000);
    const digest = summarizeViews((views ?? []) as ViewRow[]);
    if (!digest) continue;
    const key = `${share.organization_id}:${share.created_by}`;
    const entry = byCreator.get(key) ?? { orgId: share.organization_id, items: [] };
    entry.items.push({ share, digest });
    byCreator.set(key, entry);
  }

  let emails = 0;
  let links = 0;
  for (const [key, { orgId, items }] of byCreator) {
    const userId = key.slice(key.indexOf(":") + 1);
    const to = await creatorEmail(supabase, userId);
    if (!to) continue;

    const docIds = [...new Set(items.flatMap((i) => i.digest.topDocuments.map((d) => d.documentId)))];
    const roomIds = [...new Set(items.map((i) => i.share.room_id).filter((r): r is string => Boolean(r)))];
    const [{ data: docs }, { data: rooms }] = await Promise.all([
      docIds.length
        ? supabase.from("documents").select("id, name").in("id", docIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      roomIds.length
        ? supabase.from("data_rooms").select("id, name").in("id", roomIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);
    const documentNames = new Map(((docs ?? []) as { id: string; name: string }[]).map((d) => [d.id, d.name]));
    const roomNames = new Map(((rooms ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));

    const { subject, html } = digestEmail({
      links: items.map(({ share, digest }) => ({
        label: share.label,
        roomName: share.room_id ? (roomNames.get(share.room_id) ?? null) : null,
        digest,
        documentNames,
      })),
      activityUrl: activityUrl(),
    });
    // sendEmail reports failure rather than throwing; only a real send
    // advances the window, so a day with no mailbox is reported the next day.
    const sent = await sendEmail({ orgId, to: { name: "", email: to }, subject, htmlBody: html }).then(
      (r) => r.ok,
      () => false,
    );
    if (!sent) continue;
    emails += 1;
    links += items.length;
    await supabase
      .from("data_room_shares")
      .update({ digest_sent_at: now.toISOString() } as never)
      .in(
        "id",
        items.map((i) => i.share.id),
      );
  }
  return { links, emails };
}
