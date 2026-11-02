// lib/lp-privacy-request.server.ts
// Records an LP's request for a copy of their data or for erasure, and tells the
// fund manager's owners and admins (Inbox alert first, since it needs no mailbox,
// then email). Never changes or sends the LP's data.
//
// The audit entry is the record that the request was made, so it is written first
// and a failure to write it is a failure: the LP is told to try again rather than
// being told a request was sent that nobody can see. The notices are best-effort.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/integrations/adapters/app-url";
import { recordAudit } from "@/lib/lp-audit.server";
import { noticeRecipients, type NoticeMember } from "@/lib/lp-submit-notice";
import { PRIVACY_REQUEST_COOLDOWN_MS, privacyInboxAlert, privacyNotice, type PrivacyRequestKind } from "@/lib/lp-privacy-request";

type Client = SupabaseClient<any, any, any>;

export type PrivacyRequestResult = { ok: true; alreadyAsked: boolean } | { ok: false };

export async function recordPrivacyRequest(
  client: Client,
  args: { sessionId: string; orgId: string; lpName: string; kind: PrivacyRequestKind; now?: number },
): Promise<PrivacyRequestResult> {
  try {
    const since = new Date((args.now ?? Date.now()) - PRIVACY_REQUEST_COOLDOWN_MS).toISOString();
    const { data, error } = await client
      .from("onboarding_audit_log")
      .select("detail")
      .eq("organization_id", args.orgId)
      .eq("session_id", args.sessionId)
      .eq("action", "privacy.requested")
      .gte("created_at", since);
    if (error) throw new Error(error.message);
    const again = ((data ?? []) as Array<{ detail: { request?: string } | null }>).some((r) => r.detail?.request === args.kind);
    if (again) return { ok: true, alreadyAsked: true };

    const recorded = await recordAudit(client, {
      orgId: args.orgId,
      sessionId: args.sessionId,
      action: "privacy.requested",
      actorKind: "lp",
      detail: { request: args.kind },
    });
    if (!recorded) return { ok: false };

    await notifyTeam(client, args);
    return { ok: true, alreadyAsked: false };
  } catch (err) {
    console.error("[lp-privacy-request] could not record the request", err);
    return { ok: false };
  }
}

async function notifyTeam(client: Client, args: { sessionId: string; orgId: string; lpName: string; kind: PrivacyRequestKind }): Promise<void> {
  try {
    const copy = privacyInboxAlert({ lpName: args.lpName, kind: args.kind });
    const { data: thread, error } = await client
      .from("inbox_threads")
      .insert({
        organization_id: args.orgId,
        channel: "lp_onboarding",
        category: "messaging",
        subject: copy.subject,
        counterparty_name: args.lpName.slice(0, 120),
        preview: copy.preview,
        intent: "LP data request",
        ai_summary: copy.preview,
        priority: 90,
        status: "open",
        unread: true,
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !thread) throw new Error(error?.message ?? "no thread returned");
    const { error: messageError } = await client.from("inbox_messages").insert({
      organization_id: args.orgId,
      thread_id: (thread as { id: string }).id,
      direction: "inbound",
      author: "LP onboarding",
      body: copy.body,
    });
    if (messageError) throw new Error(messageError.message);
  } catch (err) {
    console.error("[lp-privacy-request] could not post the Inbox alert", err);
  }

  try {
    const [orgRes, membersRes] = await Promise.all([
      client.from("organizations").select("name").eq("id", args.orgId).maybeSingle(),
      client.from("organization_members").select("role, principal_id").eq("organization_id", args.orgId).in("role", ["owner", "admin"]).order("role", { ascending: true }).limit(100),
    ]);
    if (orgRes.error) throw new Error(orgRes.error.message);
    if (membersRes.error) throw new Error(membersRes.error.message);
    const members = (membersRes.data ?? []) as Array<{ role: string; principal_id: string }>;
    if (members.length === 0) return;
    const { data: people, error: peopleError } = await client.from("principals").select("id, email, full_name").in("id", members.map((m) => m.principal_id));
    if (peopleError) throw new Error(peopleError.message);
    const byId = new Map(((people ?? []) as Array<{ id: string; email: string | null; full_name: string | null }>).map((p) => [p.id, p]));
    const team: NoticeMember[] = members.map((m) => ({ role: m.role, email: byId.get(m.principal_id)?.email ?? null, full_name: byId.get(m.principal_id)?.full_name ?? null }));
    const mail = privacyNotice({
      orgName: (orgRes.data as { name?: string } | null)?.name ?? "your organization",
      lpName: args.lpName,
      kind: args.kind,
      reviewUrl: `${getAppUrl()}/run/onboarding`,
    });
    let sent = 0;
    let failed = 0;
    for (const to of noticeRecipients(team)) {
      const res = await sendEmail({ orgId: args.orgId, to, subject: mail.subject, htmlBody: mail.htmlBody, allowFallback: true });
      if (res.ok) sent += 1;
      else failed += 1;
    }
    await recordAudit(client, { orgId: args.orgId, sessionId: args.sessionId, action: "email.sent", actorKind: "system", detail: { kind: "privacy_notice", sent, failed } });
  } catch (err) {
    console.error("[lp-privacy-request] could not email the team", err);
  }
}
