// lib/lp-submit-notice.server.ts
// Tells the fund manager's owners and admins by email when an LP submits (or
// resubmits) their onboarding, so a finished LP isn't left waiting for someone to
// open Run › Onboarding.
//
// This emails the organization's own team, not the LP, so the deployment's shared
// sender may stand in when the organization has no mailbox of its own. If there is
// no sender at all, nothing is sent. It runs after the LP has their answer and
// never throws: a failed notice changes nothing about the submission.
//
// It runs on the service role, which bypasses row-level security, so every query
// names the organization.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/integrations/adapters/app-url";
import { recordAudit } from "@/lib/lp-audit.server";
import { inboxAlert, noticeRecipients, submissionNotice, type NoticeMember } from "@/lib/lp-submit-notice";

type Client = SupabaseClient<any, any, any>;

export interface SubmissionNoticeResult {
  /** An Inbox thread was posted. */
  inbox: boolean;
  /** People emailed. */
  sent: number;
  /** People who should have been, but the send failed. */
  failed: number;
}

export async function notifyTeamOfSubmission(
  client: Client,
  args: { sessionId: string; orgId: string; resubmitted: boolean },
): Promise<SubmissionNoticeResult> {
  const result: SubmissionNoticeResult = { inbox: false, sent: 0, failed: 0 };
  try {
    const [sessionRes, orgRes, membersRes] = await Promise.all([
      client
        .from("lp_onboarding_sessions")
        .select("lp_name, lp_type, investor_id")
        .eq("id", args.sessionId)
        .eq("organization_id", args.orgId)
        .maybeSingle(),
      client.from("organizations").select("name").eq("id", args.orgId).maybeSingle(),
      // Owners sort before admins (the role enum's order), so a cap can never cut an owner.
      client.from("organization_members").select("role, principal_id").eq("organization_id", args.orgId).in("role", ["owner", "admin"]).order("role", { ascending: true }).limit(100),
    ]);
    // A failed read is a failure, not an empty answer: nothing is sent on a guess, and the cause is logged.
    // The Inbox alert needs only the session, so the other two reads are checked after it is posted:
    // a failed team or organization read can't hide the alert.
    if (sessionRes.error) throw new Error(sessionRes.error.message);
    const session = sessionRes.data as { lp_name: string; lp_type: string | null; investor_id: string | null } | null;
    if (!session) return result;

    // The Inbox alert first: it needs no mailbox, so it lands even where email can't.
    result.inbox = await postInboxAlert(client, args.orgId, session, args.resubmitted);

    if (orgRes.error) throw new Error(orgRes.error.message);
    if (membersRes.error) throw new Error(membersRes.error.message);
    const members = (membersRes.data ?? []) as Array<{ role: string; principal_id: string }>;
    if (members.length === 0) return result;
    const { data: people, error: peopleError } = await client
      .from("principals")
      .select("id, email, full_name")
      .in(
        "id",
        members.map((m) => m.principal_id),
      );
    if (peopleError) throw new Error(peopleError.message);
    const byId = new Map(((people ?? []) as Array<{ id: string; email: string | null; full_name: string | null }>).map((p) => [p.id, p]));
    const team: NoticeMember[] = members.map((m) => ({
      role: m.role,
      email: byId.get(m.principal_id)?.email ?? null,
      full_name: byId.get(m.principal_id)?.full_name ?? null,
    }));

    const recipients = noticeRecipients(team);
    if (recipients.length === 0) return result;

    const mail = submissionNotice({
      orgName: (orgRes.data as { name?: string } | null)?.name ?? "your organization",
      lpName: session.lp_name,
      lpType: session.lp_type,
      resubmitted: args.resubmitted,
      reviewUrl: `${getAppUrl()}/run/onboarding`,
    });

    for (const to of recipients) {
      const sent = await sendEmail({ orgId: args.orgId, to, subject: mail.subject, htmlBody: mail.htmlBody, allowFallback: true });
      if (sent.ok) result.sent += 1;
      else result.failed += 1;
    }
    // One entry for the notice, not one per person: who was told is the team, not an address.
    await recordAudit(client, {
      orgId: args.orgId,
      sessionId: args.sessionId,
      action: "email.sent",
      actorKind: "system",
      detail: { kind: "team_notice", sent: result.sent, failed: result.failed, resubmitted: args.resubmitted },
    });
  } catch (err) {
    console.error("[lp-submit-notice] could not notify the team", err);
  }
  return result;
}

/**
 * One Inbox thread per submission (a resubmission is a new event). Never throws:
 * if it can't be posted, the email still goes. Linked to the investor record when
 * the LP came from one, so the thread opens into that context.
 */
async function postInboxAlert(
  client: Client,
  orgId: string,
  session: { lp_name: string; lp_type: string | null; investor_id: string | null },
  resubmitted: boolean,
): Promise<boolean> {
  try {
    const copy = inboxAlert({ lpName: session.lp_name, lpType: session.lp_type, resubmitted });
    const { data, error } = await client
      .from("inbox_threads")
      .insert({
        organization_id: orgId,
        channel: "lp_onboarding",
        category: "messaging",
        subject: copy.subject,
        counterparty_name: session.lp_name,
        preview: copy.preview,
        intent: "LP onboarding",
        ai_summary: copy.preview,
        priority: 80,
        status: "open",
        unread: true,
        investor_id: session.investor_id,
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "no thread returned");
    const { error: messageError } = await client.from("inbox_messages").insert({
      organization_id: orgId,
      thread_id: (data as { id: string }).id,
      direction: "inbound",
      author: "LP onboarding",
      body: copy.body,
    });
    if (messageError) throw new Error(messageError.message);
    return true;
  } catch (err) {
    console.error("[lp-submit-notice] could not post the Inbox alert", err);
    return false;
  }
}
