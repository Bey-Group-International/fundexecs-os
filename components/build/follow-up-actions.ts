"use server";

// Following up with a data-room reader: Earn drafts, the operator edits and
// sends from their own mailbox. Nothing is ever sent without that click.
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { canWriteOrg } from "@/lib/rbac";
import { createServerClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { normalizeEmail } from "@/lib/crm/contact-match";
import { loadRoomEngagement } from "@/lib/data-room-engagement.server";
import { crmMatches, draftFollowUp, logFollowUpOnTimeline } from "@/lib/data-room-crm.server";
import { followUpHtml, type FollowUpDraft } from "@/lib/data-room-crm";
import { mailboxFor } from "@/lib/meetings/mailbox.server";

const ROOM = "/build/data_room";

type Ctx = NonNullable<Awaited<ReturnType<typeof getSessionContext>>> & { orgId: string };

/**
 * The reader this follow-up is for, checked against the room's own activity:
 * only someone who actually read this room through one of its links, by email,
 * can be written to. That is what stops this from mailing arbitrary addresses.
 */
async function loadReader(roomId: string, viewerKey: string) {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Sign in again to follow up." } as const;
  if (!canWriteOrg(ctx.role)) return { error: "Your role is view-only. Ask an owner or admin to follow up." } as const;
  if (typeof roomId !== "string" || typeof viewerKey !== "string" || !viewerKey.startsWith("email:")) {
    return { error: "Only a reader who gave an email can be followed up." } as const;
  }
  const supabase = await createServerClient();
  const { data: room } = await supabase
    .from("data_rooms")
    .select("id, name")
    .eq("id", roomId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (!room) return { error: "That room is not in this workspace." } as const;
  const { engagement, reads } = await loadRoomEngagement(supabase, ctx.orgId, roomId);
  const reader = engagement.investors.find((a) => a.key === viewerKey && a.email);
  if (!reader?.email) return { error: "That reader isn't in this room's activity." } as const;
  return {
    ctx: ctx as Ctx,
    supabase,
    room: room as { id: string; name: string },
    reader: reader as typeof reader & { email: string },
    read: reads.get(viewerKey) ?? null,
  } as const;
}

async function senderName(supabase: Awaited<ReturnType<typeof createServerClient>>, userId: string): Promise<string | null> {
  const { data } = await supabase.from("principals").select("full_name").eq("id", userId).maybeSingle();
  return ((data as { full_name?: string | null } | null)?.full_name ?? null) || null;
}

export async function draftInvestorFollowUp(
  roomId: string,
  viewerKey: string,
): Promise<{ ok: true; draft: FollowUpDraft; to: string } | { ok: false; error: string }> {
  const r = await loadReader(roomId, viewerKey);
  if ("error" in r) return { ok: false, error: r.error ?? "Couldn't draft." };
  const [match, sender] = await Promise.all([
    crmMatches(r.supabase, r.ctx.orgId, [r.reader.email]).then((m) => m.get(normalizeEmail(r.reader.email))),
    senderName(r.supabase, r.ctx.userId),
  ]);
  const draft = await draftFollowUp(r.reader, {
    roomName: r.room.name,
    recipientName: match?.contactName ?? null,
    senderName: sender,
    nextStep: r.read?.follow_up ?? null,
    summary: r.read?.summary ?? null,
  });
  return { ok: true, draft, to: r.reader.email };
}

export async function sendInvestorFollowUp(
  roomId: string,
  viewerKey: string,
  subject: string,
  body: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = typeof subject === "string" ? subject.trim() : "";
  const b = typeof body === "string" ? body.trim() : "";
  if (!s || !b) return { ok: false, error: "Add a subject and a message." };
  if (s.length > 200 || b.length > 8000) return { ok: false, error: "That's too long to send." };

  const r = await loadReader(roomId, viewerKey);
  if ("error" in r) return { ok: false, error: r.error ?? "Couldn't send." };

  // From the operator's own address when they've connected Google, else the
  // workspace's connected mailbox. Never the system sender: this is personal.
  const mailbox = await mailboxFor(r.supabase, r.ctx.userId, r.ctx.orgId);
  if (!mailbox.ok) {
    return {
      ok: false,
      error: "No Google account can send for you yet. Connect one in Settings › Integrations, or connect your calendar, then send again.",
    };
  }
  const sent = await sendEmail({
    orgId: r.ctx.orgId,
    credentials: { gmailAccessToken: mailbox.token },
    to: { name: "", email: r.reader.email },
    subject: s,
    htmlBody: followUpHtml(b),
  });
  if (!sent.ok) return { ok: false, error: "Google didn't accept the message. Try again in a moment." };

  const sentAt = new Date().toISOString();
  await r.supabase
    .from("data_room_follow_ups")
    .insert({
      organization_id: r.ctx.orgId,
      room_id: r.room.id,
      viewer_key: viewerKey,
      recipient_email: r.reader.email,
      subject: s,
      body: b,
      sent_by: r.ctx.userId,
      sent_at: sentAt,
    } as never)
    .then(() => undefined, () => undefined);
  const match = (await crmMatches(r.supabase, r.ctx.orgId, [r.reader.email]).catch(() => new Map())).get(
    normalizeEmail(r.reader.email),
  );
  await logFollowUpOnTimeline(r.supabase, r.ctx.orgId, match, {
    actorId: r.ctx.userId,
    subject: s,
    body: b,
    roomId: r.room.id,
    sentAt,
  }).catch(() => undefined);
  revalidatePath(ROOM);
  return { ok: true };
}
