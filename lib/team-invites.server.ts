// lib/team-invites.server.ts
// Storing, emailing and claiming Team invites (see lib/team-invites for the pure
// half and supabase/migrations/20261103120000_organization_invites.sql for why).
//
// Everything here runs on the service role. Callers MUST have already passed an
// admin guard; nothing in this file decides who may invite.
import { createServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { inviteIsLive, memberAddedEmail } from "@/lib/team-invites";
import type { MemberRole } from "@/lib/supabase/database.types";

type ServiceClient = ReturnType<typeof createServiceClient>;

/** Store (or refresh) a pending invite for an address with no account yet. */
export async function savePendingInvite(
  svc: ServiceClient,
  args: {
    orgId: string;
    email: string;
    role: MemberRole;
    invitedBy: string | null;
    byPlatformAdmin: boolean;
  },
): Promise<{ error?: string }> {
  const email = args.email.trim().toLowerCase();
  const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();

  const { data: open } = await svc
    .from("organization_invites")
    .select("id")
    .eq("organization_id", args.orgId)
    .eq("email", email)
    .is("accepted_at", null)
    .maybeSingle();

  // Re-inviting refreshes the role, sender and clock rather than stacking rows.
  const { error } = open
    ? await svc
        .from("organization_invites")
        .update({
          role: args.role,
          invited_by: args.invitedBy,
          invited_by_platform_admin: args.byPlatformAdmin,
          expires_at: expiresAt,
        })
        .eq("id", open.id)
    : await svc.from("organization_invites").insert({
        organization_id: args.orgId,
        email,
        role: args.role,
        invited_by: args.invitedBy,
        invited_by_platform_admin: args.byPlatformAdmin,
        expires_at: expiresAt,
      });
  return error ? { error: "Could not save that invite. Please try again." } : {};
}

export interface MemberAddedResult {
  sent: boolean;
  /** Why nothing was sent, for logs and the admin-facing notice. */
  detail: string;
}

/**
 * Email someone that they were added. Never throws and never fails the add: the
 * membership or pending invite already stands, and an admin can tell the person
 * directly if mail is not configured.
 */
export async function sendMemberAddedEmail(
  svc: ServiceClient,
  args: {
    orgId: string;
    email: string;
    role: MemberRole;
    inviterId: string | null;
    pending: boolean;
    reminder?: boolean;
  },
): Promise<MemberAddedResult> {
  try {
    const [{ data: org }, { data: inviter }] = await Promise.all([
      svc.from("organizations").select("name").eq("id", args.orgId).maybeSingle(),
      args.inviterId
        ? svc.from("principals").select("full_name, email").eq("id", args.inviterId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const inviterName =
      (inviter as { full_name?: string | null; email?: string | null } | null)?.full_name?.trim() ||
      (inviter as { email?: string | null } | null)?.email ||
      null;
    const template = memberAddedEmail({
      orgName: (org as { name?: string } | null)?.name ?? "your organization",
      inviterName,
      email: args.email,
      role: args.role,
      pending: args.pending,
      reminder: args.reminder,
    });
    // The org's connected mailbox first; the deployment's backup sender when
    // that cannot send, because an invite nobody hears about strands the person.
    const result = await sendEmail({
      orgId: args.orgId,
      to: { name: args.email, email: args.email },
      subject: template.subject,
      htmlBody: template.html,
      fromName: inviterName ?? undefined,
      allowFallback: true,
    });
    if (!result.ok) console.warn("[team-invite] email not sent:", result.detail);
    return { sent: result.ok, detail: result.detail };
  } catch (err) {
    console.warn("[team-invite] email failed:", err);
    return { sent: false, detail: err instanceof Error ? err.message : "email failed" };
  }
}

/**
 * Attach a just-authenticated person to every organization that invited their
 * address. Only a CONFIRMED address claims anything: anyone can register
 * someone@firm.com, only the mailbox owner can confirm it. Returns how many
 * invites were claimed; never throws, so a hiccup cannot block sign-in.
 */
export async function claimPendingInvites(args: {
  userId: string;
  email: string | null | undefined;
  emailConfirmed: boolean;
}): Promise<number> {
  const email = args.email?.trim().toLowerCase();
  if (!email || !args.emailConfirmed) return 0;
  try {
    const svc = createServiceClient();
    const { data: invites } = await svc
      .from("organization_invites")
      .select("*")
      .eq("email", email)
      .is("accepted_at", null);

    let claimed = 0;
    for (const invite of invites ?? []) {
      if (!inviteIsLive(invite)) continue;
      const { error } = await svc.from("organization_members").insert({
        organization_id: invite.organization_id,
        principal_id: args.userId,
        role: invite.role,
      });
      // 23505 = already a member (lost a race, or added directly meanwhile).
      if (error && error.code !== "23505") {
        console.error("[team-invite] claim failed:", error);
        continue;
      }
      await svc
        .from("organization_invites")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", invite.id);
      claimed += 1;
    }
    return claimed;
  } catch (err) {
    console.error("[team-invite] claimPendingInvites failed:", err);
    return 0;
  }
}

/**
 * Whether a platform admin has a live pending invite out for this address. Such
 * an invite stands in for access-request approval; an ordinary org admin's does
 * not, so they cannot admit new people to the platform.
 */
export async function hasPlatformAdminInvite(
  svc: ServiceClient,
  email: string,
): Promise<boolean> {
  const { data } = await svc
    .from("organization_invites")
    .select("expires_at, accepted_at")
    .eq("email", email.trim().toLowerCase())
    .eq("invited_by_platform_admin", true)
    .is("accepted_at", null);
  return (data ?? []).some((row) => inviteIsLive(row));
}
