"use server";

// Run › Onboarding: making the unique link for a prospective LP, sending it, and
// giving the LP a code by another route. All owner/admin only. The organization
// comes from the session; a fund or LP named in the request must belong to it.
import { revalidatePath } from "next/cache";
import { requireOrgContext } from "@/lib/auth";
import { requireOrgAdmin } from "@/lib/rbac";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { escapeHtml, sendEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/integrations/adapters/app-url";
import { issueCode } from "@/lib/lp-access.server";
import { recordAudit } from "@/lib/lp-audit.server";
import { carryForwardChecks, type CarriedSummary } from "@/lib/lp-reuse.server";
import { LINK_TTL_DAYS, validateLinkInput } from "@/lib/lp-wizard";

const PAGE = "/run/onboarding";
const GENERIC = "Couldn't do that. Try again.";

async function authorize() {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false as const, error: "Sign in again to continue." };
  const admin = requireOrgAdmin(auth.ctx.role);
  if (!admin.ok) return { ok: false as const, error: "Only organization owners and admins can onboard LPs." };
  return { ok: true as const, ctx: auth.ctx };
}

export type CreateLinkResult =
  | { ok: true; sessionId: string; url: string; carried: CarriedSummary[] }
  | { ok: false; error: string };

export async function createLpLinkAction(input: unknown): Promise<CreateLinkResult> {
  const who = await authorize();
  if (!who.ok) return who;
  const parsed = validateLinkInput(input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  try {
    const supabase = await createServerClient();
    if (v.fundId) {
      const { data: fund } = await supabase
        .from("funds")
        .select("id")
        .eq("id", v.fundId)
        .eq("organization_id", who.ctx.orgId)
        .maybeSingle();
      if (!fund) return { ok: false, error: "That fund wasn't found." };
    }
    const { data, error } = await supabase
      .from("lp_onboarding_sessions")
      .insert({
        organization_id: who.ctx.orgId,
        lp_name: v.lpName,
        lp_email: v.lpEmail,
        lp_type: v.lpType,
        owner_threshold_pct: v.ownerThresholdPct,
        fund_id: v.fundId,
        commitment_amount: v.commitmentAmount,
        expires_at: new Date(Date.now() + LINK_TTL_DAYS * 86_400_000).toISOString(),
      } as never)
      .select("id, token")
      .single();
    const row = data as { id: string; token: string } | null;
    if (error || !row) {
      console.error("createLpLinkAction failed", { code: error?.code, message: error?.message });
      return { ok: false, error: GENERIC };
    }
    // A returning LP keeps their earlier ID verification. Best-effort: it never fails the link.
    const service = hasSupabaseServiceEnv() ? createServiceClient() : null;
    const carried = service ? await carryForwardChecks(service, { orgId: who.ctx.orgId, sessionId: row.id, email: v.lpEmail }) : [];
    // Who made the link. Best-effort: the link exists either way.
    if (service) {
      await recordAudit(service, {
        orgId: who.ctx.orgId,
        sessionId: row.id,
        action: "link.created",
        actorKind: "user",
        actorId: who.ctx.userId,
        detail: { source: "run", lp_type: v.lpType, has_fund: Boolean(v.fundId), carried: carried.length },
      });
    }
    revalidatePath(PAGE);
    return { ok: true, sessionId: row.id, url: `${getAppUrl()}/lp/${row.token}`, carried };
  } catch (err) {
    console.error("createLpLinkAction threw", err);
    return { ok: false, error: GENERIC };
  }
}

/** The LP's own session row, if it is this organization's. */
async function ownSession(sessionId: unknown, orgId: string) {
  if (typeof sessionId !== "string" || !sessionId) return null;
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("lp_onboarding_sessions")
    .select("id, organization_id, lp_name, lp_email, token, review_state, expires_at")
    .eq("id", sessionId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return (data as { id: string; organization_id: string; lp_name: string; lp_email: string; token: string; review_state: string; expires_at: string } | null) ?? null;
}

export type EmailLinkResult = { ok: true; sent: boolean; detail: string } | { ok: false; error: string };

/** Emails the link from the organization's own mailbox. Reports honestly when it could not send. */
export async function emailLpLinkAction(sessionId: unknown): Promise<EmailLinkResult> {
  const who = await authorize();
  if (!who.ok) return who;
  try {
    const session = await ownSession(sessionId, who.ctx.orgId);
    if (!session) return { ok: false, error: "That LP wasn't found." };
    if (session.review_state === "approved" || session.review_state === "rejected") {
      return { ok: false, error: "This LP's onboarding is already decided." };
    }
    if (new Date(session.expires_at).getTime() < Date.now()) return { ok: false, error: "This link has expired. Make a new one." };
    const supabase = await createServerClient();
    const { data: org } = await supabase.from("organizations").select("name").eq("id", who.ctx.orgId).maybeSingle();
    const orgName = (org as { name?: string } | null)?.name ?? "your fund manager";
    const url = `${getAppUrl()}/lp/${session.token}`;
    const result = await sendEmail({
      orgId: who.ctx.orgId,
      to: { name: session.lp_name, email: session.lp_email },
      subject: `${orgName}: your investor onboarding`,
      htmlBody:
        `<p>Hello ${escapeHtml(session.lp_name)},</p>` +
        `<p>${escapeHtml(orgName)} has invited you to complete your investor onboarding. It takes about ten minutes.</p>` +
        `<p><a href="${escapeHtml(url)}">Start your onboarding</a></p>` +
        `<p>You'll be asked for a code we email you when you open the link. The link works for ${LINK_TTL_DAYS} days.</p>`,
      allowFallback: true,
    });
    if (hasSupabaseServiceEnv()) {
      await recordAudit(createServiceClient(), {
        orgId: who.ctx.orgId,
        sessionId: session.id,
        action: "email.sent",
        actorKind: "user",
        actorId: who.ctx.userId,
        detail: { kind: "link", ok: result.ok },
      });
    }
    return { ok: true, sent: result.ok, detail: result.detail };
  } catch (err) {
    console.error("emailLpLinkAction threw", err);
    return { ok: false, error: GENERIC };
  }
}

export type CodeResult = { ok: true; code: string; expiresAt: string } | { ok: false; error: string };

/**
 * A code to give the LP by phone or message when email can't reach them. It is
 * shown once and kept only as a hash. Any earlier code stops working.
 */
export async function generateAccessCodeAction(sessionId: unknown): Promise<CodeResult> {
  const who = await authorize();
  if (!who.ok) return who;
  if (!hasSupabaseServiceEnv()) return { ok: false, error: GENERIC };
  try {
    const session = await ownSession(sessionId, who.ctx.orgId);
    if (!session) return { ok: false, error: "That LP wasn't found." };
    if (session.review_state === "approved" || session.review_state === "rejected") {
      return { ok: false, error: "This LP's onboarding is already decided." };
    }
    if (new Date(session.expires_at).getTime() < Date.now()) return { ok: false, error: "This link has expired. Make a new one." };
    const service = createServiceClient();
    const issued = await issueCode(service, { id: session.id, organization_id: session.organization_id }, "gp", who.ctx.userId);
    if (issued.ok) {
      await recordAudit(service, {
        orgId: session.organization_id,
        sessionId: session.id,
        action: "code.issued_by_manager",
        actorKind: "user",
        actorId: who.ctx.userId,
      });
    }
    return issued;
  } catch (err) {
    console.error("generateAccessCodeAction threw", err);
    return { ok: false, error: GENERIC };
  }
}
