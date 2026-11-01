"use server";

// The LP's setup wizard. Public and token-gated (the LP has no account), so every
// write goes through the service-role client, after two checks:
//   * the link is live (right token, not expired), and
//   * for everything except asking for and entering the code, this browser has
//     passed the emailed-code check (lib/lp-access.server.ts).
// The wizard is writable only while the review state is open: before submission,
// or after the fund manager asked for changes. Once submitted it is read-only
// until the fund manager decides.
import { openProfileRow, sealProfileWrite } from "@/lib/lp-pii";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { escapeHtml, sendEmail } from "@/lib/email";
import { getLinkSession, grantLpPass, hasLpPass, issueCode, verifyCode, type LinkSession } from "@/lib/lp-access.server";
import { getAppUrl } from "@/lib/integrations/adapters/app-url";
import { stripeIdentityProvider } from "@/lib/providers/stripe-identity";
import { identityOutcome, type IdentityState } from "@/lib/lp-identity";
import { readIdentityCheck, refreshIdentityCheck } from "@/lib/lp-identity.server";
import { runOfacScreen } from "@/lib/ofac.server";
import { recordAudit } from "@/lib/lp-audit.server";
import { notifyTeamOfSubmission } from "@/lib/lp-submit-notice.server";
import {
  ACCREDITATION_BASIS_LABEL,
  CONSENT_TEXT_VERSION,
  incompleteSteps,
  maskEmail,
  STEP_LABEL,
  validateAccreditation,
  validateConsent,
  validateDetails,
  validateOwners,
  wizardEditable,
  type WizardData,
} from "@/lib/lp-wizard";
import type { LpType } from "@/lib/supabase/database.types";

export type WizardResult = { ok: true } | { ok: false; error: string };

const UNAVAILABLE = "This link isn't available. Contact your fund manager.";
const GENERIC = "Couldn't save. Try again.";

function service() {
  return hasSupabaseServiceEnv() ? createServiceClient() : null;
}

/** A live link whose holder has passed the code check. */
async function passedContext(token: string) {
  const supabase = service();
  if (!supabase) return null;
  const session = await getLinkSession(supabase, token);
  if (!session) return null;
  if (!(await hasLpPass(session.id))) return null;
  return { supabase, session };
}

/** As above, and the wizard is still open for edits. */
async function editableContext(token: string): Promise<{ supabase: NonNullable<ReturnType<typeof service>>; session: LinkSession } | WizardResult> {
  const ctx = await passedContext(token);
  if (!ctx) return { ok: false, error: UNAVAILABLE };
  if (!wizardEditable(ctx.session.review_state as never)) {
    return { ok: false, error: "This has been submitted and is with your fund manager for review." };
  }
  return ctx;
}

const isResult = (v: unknown): v is WizardResult => typeof v === "object" && v !== null && "ok" in v;

// ---- the code --------------------------------------------------------------

export async function requestAccessCodeAction(
  token: string,
): Promise<{ ok: true; sent: boolean; maskedEmail: string } | { ok: false; error: string }> {
  try {
    const supabase = service();
    if (!supabase) return { ok: false, error: UNAVAILABLE };
    const session = await getLinkSession(supabase, token);
    if (!session || session.review_state === "rejected") return { ok: false, error: UNAVAILABLE };

    const issued = await issueCode(supabase, session, "email", null);
    if (!issued.ok) return issued;

    const { data: org } = await supabase.from("organizations").select("name").eq("id", session.organization_id).maybeSingle();
    const orgName = (org as { name?: string } | null)?.name ?? "your fund manager";
    const sent = await sendEmail({
      orgId: session.organization_id,
      to: { name: session.lp_name, email: session.lp_email },
      subject: `Your access code for ${orgName}`,
      htmlBody:
        `<p>Hello ${escapeHtml(session.lp_name)},</p>` +
        `<p>Your access code for onboarding with ${escapeHtml(orgName)} is:</p>` +
        `<p style="font-size:24px;letter-spacing:4px;font-weight:600">${issued.code}</p>` +
        `<p>It works for 15 minutes. If you didn't ask for it, you can ignore this email.</p>`,
      allowFallback: true,
    });
    await recordAudit(supabase, {
      orgId: session.organization_id,
      sessionId: session.id,
      action: "code.requested",
      actorKind: "lp",
      detail: { emailed: sent.ok },
    });
    return { ok: true, sent: sent.ok, maskedEmail: maskEmail(session.lp_email) };
  } catch (err) {
    console.error("requestAccessCodeAction failed", err);
    return { ok: false, error: GENERIC };
  }
}

export async function verifyAccessCodeAction(token: string, code: string): Promise<WizardResult> {
  try {
    const supabase = service();
    if (!supabase) return { ok: false, error: UNAVAILABLE };
    const session = await getLinkSession(supabase, token);
    if (!session || session.review_state === "rejected") return { ok: false, error: UNAVAILABLE };

    const verified = await verifyCode(supabase, session, code);
    if (!verified.ok) {
      // Only a wrong guess is recorded: each spends one of five tries, so a probe leaves a bounded trail
      // while an expired or locked code (which can be retried without limit) cannot flood the log.
      if (verified.reason === "wrong") {
        await recordAudit(supabase, { orgId: session.organization_id, sessionId: session.id, action: "code.wrong", actorKind: "lp" });
      }
      return { ok: false, error: verified.error };
    }

    await recordAudit(supabase, { orgId: session.organization_id, sessionId: session.id, action: "code.verified", actorKind: "lp" });
    await grantLpPass(session.id);
    // The first time an LP gets in, the review is under way. The change is logged by the database.
    if (session.review_state === "not_started") {
      await supabase.from("lp_onboarding_sessions").update({ review_state: "in_progress" } as never).eq("id", session.id);
    }
    revalidatePath(`/lp/${token}`);
    return { ok: true };
  } catch (err) {
    console.error("verifyAccessCodeAction failed", err);
    return { ok: false, error: GENERIC };
  }
}

// ---- the steps -------------------------------------------------------------

export async function saveDetailsAction(token: string, input: unknown): Promise<WizardResult> {
  const ctx = await editableContext(token);
  if (isResult(ctx)) return ctx;
  const parsed = validateDetails(ctx.session.lp_type as LpType, input);
  if (!parsed.ok) return parsed;
  const d = parsed.value;
  try {
    const { error } = await ctx.supabase.from("lp_onboarding_profiles").upsert(
      {
        session_id: ctx.session.id,
        organization_id: ctx.session.organization_id,
        legal_name: d.legalName,
        entity_type: d.entityType,
        country: d.country,
        ...sealProfileWrite(ctx.session.id, { contact_phone: d.contactPhone }),
        signatory_name: d.signatoryName,
        signatory_title: d.signatoryTitle,
      } as never,
      { onConflict: "session_id" },
    );
    if (error) {
      console.error("saveDetailsAction failed", { code: error.code, message: error.message });
      return { ok: false, error: GENERIC };
    }
    revalidatePath(`/lp/${token}`);
    return { ok: true };
  } catch (err) {
    console.error("saveDetailsAction threw", err);
    return { ok: false, error: GENERIC };
  }
}

export async function saveOwnersAction(token: string, input: unknown): Promise<WizardResult> {
  const ctx = await editableContext(token);
  if (isResult(ctx)) return ctx;
  if (ctx.session.lp_type !== "entity") return { ok: false, error: "This step doesn't apply to you." };
  const parsed = validateOwners(input);
  if (!parsed.ok) return parsed;
  try {
    // Add the new list, then remove the old one, so a failure never leaves the LP with nobody listed.
    const { data: old } = await ctx.supabase.from("lp_onboarding_owners").select("id").eq("session_id", ctx.session.id);
    const rows = parsed.value.map((o) => ({
      organization_id: ctx.session.organization_id,
      session_id: ctx.session.id,
      full_name: o.fullName,
      role: o.role,
      ownership_pct: o.ownershipPct,
      country: o.country,
    }));
    const oldIds = ((old ?? []) as { id: string }[]).map((r) => r.id);
    // The database caps a session at 25 owners, so clear the old rows first when
    // the two lists together would exceed it; otherwise add before removing.
    if (oldIds.length + rows.length > 25) {
      await ctx.supabase.from("lp_onboarding_owners").delete().in("id", oldIds);
      const { error } = await ctx.supabase.from("lp_onboarding_owners").insert(rows as never);
      if (error) {
        console.error("saveOwnersAction failed", { code: error.code, message: error.message });
        return { ok: false, error: GENERIC };
      }
    } else {
      const { error } = await ctx.supabase.from("lp_onboarding_owners").insert(rows as never);
      if (error) {
        console.error("saveOwnersAction failed", { code: error.code, message: error.message });
        return { ok: false, error: GENERIC };
      }
      if (oldIds.length) await ctx.supabase.from("lp_onboarding_owners").delete().in("id", oldIds);
    }
    revalidatePath(`/lp/${token}`);
    return { ok: true };
  } catch (err) {
    console.error("saveOwnersAction threw", err);
    return { ok: false, error: GENERIC };
  }
}

export async function grantConsentAction(token: string, input: unknown): Promise<WizardResult> {
  const ctx = await editableContext(token);
  if (isResult(ctx)) return ctx;
  const parsed = validateConsent(input);
  if (!parsed.ok) return parsed;
  try {
    const { error } = await ctx.supabase.from("lp_onboarding_consents").insert({
      organization_id: ctx.session.organization_id,
      session_id: ctx.session.id,
      scope: parsed.value.scope,
      text_version: CONSENT_TEXT_VERSION,
      typed_name: parsed.value.typedName,
    } as never);
    if (error) {
      console.error("grantConsentAction failed", { code: error.code, message: error.message });
      return { ok: false, error: GENERIC };
    }
    revalidatePath(`/lp/${token}`);
    return { ok: true };
  } catch (err) {
    console.error("grantConsentAction threw", err);
    return { ok: false, error: GENERIC };
  }
}

export async function saveAccreditationAction(token: string, input: unknown): Promise<WizardResult> {
  const ctx = await editableContext(token);
  if (isResult(ctx)) return ctx;
  const parsed = validateAccreditation(input);
  if (!parsed.ok) return parsed;
  try {
    const { error } = await ctx.supabase.from("lp_onboarding_profiles").upsert(
      {
        session_id: ctx.session.id,
        organization_id: ctx.session.organization_id,
        accreditation_basis: parsed.value.basis,
        ...sealProfileWrite(ctx.session.id, { source_of_funds: parsed.value.sourceOfFunds }),
        accreditation_statement_at: new Date().toISOString(),
      } as never,
      { onConflict: "session_id" },
    );
    if (error) {
      console.error("saveAccreditationAction failed", { code: error.code, message: error.message });
      return { ok: false, error: GENERIC };
    }
    revalidatePath(`/lp/${token}`);
    return { ok: true };
  } catch (err) {
    console.error("saveAccreditationAction threw", err);
    return { ok: false, error: GENERIC };
  }
}

// ---- ID verification (Stripe Identity) -------------------------------------

export type IdentityResult = { ok: true; state: IdentityState; url: string | null } | { ok: false; error: string };

/**
 * Starts (or resumes) the LP's ID verification and returns the hosted link. It
 * refuses unless the LP has consented to identity verification, and it never
 * disturbs an identity check the fund manager has already recorded or decided.
 */
export async function startIdentityAction(token: string): Promise<IdentityResult> {
  const ctx = await editableContext(token);
  if (isResult(ctx)) return ctx as { ok: false; error: string };
  const { supabase, session } = ctx;
  try {
    if (!stripeIdentityProvider.isConfigured()) {
      return { ok: false, error: "Online ID verification isn't available. Your fund manager will verify you directly." };
    }

    const { data: consents } = await supabase
      .from("lp_onboarding_consents")
      .select("scope")
      .eq("session_id", session.id)
      .eq("scope", "identity_verification")
      .eq("text_version", CONSENT_TEXT_VERSION)
      .limit(1);
    if (!consents || consents.length === 0) return { ok: false, error: "Give your consent to ID verification first." };

    const existing = await readIdentityCheck(supabase, session.id);
    if (existing?.status === "clear") return { ok: true, state: "verified", url: null };
    if (existing && existing.status !== "pending" && existing.method !== "stripe_identity") {
      return { ok: false, error: "Your fund manager is already handling your ID check." };
    }

    // Resume a verification already started, rather than opening a second one.
    if (existing?.method === "stripe_identity" && existing.vendor_ref) {
      const current = await refreshIdentityCheck(supabase, session.id, session.organization_id);
      if (!current.ok) return current;
      if (current.state === "canceled") {
        return { ok: false, error: "This verification can't be continued. Ask your fund manager to start a new one." };
      }
      if (current.state === "verified" || current.state === "processing" || current.url) return current;
      return { ok: false, error: "We couldn't reopen your verification. Try again in a moment." };
    }

    const started = await stripeIdentityProvider.initiate({
      orgId: session.organization_id,
      subjectId: session.id,
      subjectType: session.lp_type === "individual" ? "individual" : "entity",
      subjectName: session.lp_name,
      subjectEmail: session.lp_email,
      level: "kyc",
      requestedBy: "lp-wizard",
      returnUrl: `${getAppUrl()}/lp/${token}`,
    });
    const verificationId = started.data?.verificationId;
    if (!started.ok || !started.reference || !verificationId) {
      return { ok: false, error: "We couldn't start ID verification. Try again in a moment." };
    }

    const outcome = identityOutcome(started.data!);
    const row = { ...outcome.check, method: "stripe_identity", vendor_ref: verificationId };
    const { error } = existing
      ? await supabase.from("onboarding_checks").update(row as never).eq("session_id", session.id).eq("kind", "identity").eq("status", "pending")
      : await supabase.from("onboarding_checks").insert({ organization_id: session.organization_id, session_id: session.id, kind: "identity", ...row } as never);
    if (error) {
      console.error("startIdentityAction failed", { code: error.code, message: error.message });
      return { ok: false, error: GENERIC };
    }
    revalidatePath(`/lp/${token}`);
    return { ok: true, state: outcome.state, url: started.reference };
  } catch (err) {
    console.error("startIdentityAction threw", err);
    return { ok: false, error: GENERIC };
  }
}

/** Asks where the LP's verification stands. Safe to call repeatedly; used when they return from Stripe. */
export async function checkIdentityAction(token: string): Promise<IdentityResult> {
  const ctx = await passedContext(token);
  if (!ctx) return { ok: false, error: UNAVAILABLE };
  try {
    const res = await refreshIdentityCheck(ctx.supabase, ctx.session.id, ctx.session.organization_id);
    if (res.ok && res.state === "verified") revalidatePath(`/lp/${token}`);
    return res;
  } catch (err) {
    console.error("checkIdentityAction threw", err);
    return { ok: false, error: GENERIC };
  }
}

// ---- submit ----------------------------------------------------------------

export async function submitWizardAction(token: string): Promise<WizardResult> {
  const ctx = await editableContext(token);
  if (isResult(ctx)) return ctx;
  try {
    const identityEnabled = stripeIdentityProvider.isConfigured();
    const [profileRes, ownersRes, consentsRes, identityCheck] = await Promise.all([
      ctx.supabase.from("lp_onboarding_profiles").select("*").eq("session_id", ctx.session.id).maybeSingle(),
      ctx.supabase.from("lp_onboarding_owners").select("role").eq("session_id", ctx.session.id),
      ctx.supabase.from("lp_onboarding_consents").select("scope, text_version").eq("session_id", ctx.session.id),
      identityEnabled ? readIdentityCheck(ctx.supabase, ctx.session.id) : Promise.resolve(null),
    ]);
    // source_of_funds is stored encrypted; the readiness check needs its length.
    const profileRow = profileRes.data ? openProfileRow(profileRes.data as unknown as { session_id: string }, ctx.session.id) : null;
    const profile = (profileRow ?? null) as unknown as WizardData["profile"] & { accreditation_basis: keyof typeof ACCREDITATION_BASIS_LABEL | null };
    const missing = incompleteSteps({
      lpType: ctx.session.lp_type as LpType,
      profile,
      owners: (ownersRes.data ?? []) as WizardData["owners"],
      consents: (consentsRes.data ?? []) as WizardData["consents"],
      identity: { enabled: identityEnabled, verified: identityCheck?.status === "clear" },
    });
    if (missing.length) {
      return { ok: false, error: `Finish these first: ${missing.map((s) => STEP_LABEL[s]).join(", ")}.` };
    }

    // Only move forward from a state that is still open, so a double click or a replay cannot reopen a decided LP.
    const { data: moved, error } = await ctx.supabase
      .from("lp_onboarding_sessions")
      .update({ review_state: "submitted", submitted_at: new Date().toISOString() } as never)
      .eq("id", ctx.session.id)
      .in("review_state", ["not_started", "in_progress", "changes_requested"])
      .select("id");
    if (error || !moved || moved.length === 0) {
      if (error) console.error("submitWizardAction failed", { code: error.code, message: error.message });
      return { ok: false, error: GENERIC };
    }

    // Give the reviewer the accreditation claim as a check to confirm. Never overwrite one they already recorded.
    const basis = profile?.accreditation_basis ? ACCREDITATION_BASIS_LABEL[profile.accreditation_basis] : null;
    await ctx.supabase.from("onboarding_checks").upsert(
      {
        organization_id: ctx.session.organization_id,
        session_id: ctx.session.id,
        kind: "accreditation",
        status: "pending",
        method: "manual",
        summary: basis ? `The LP states: ${basis}. Confirm before approving.` : null,
      } as never,
      { onConflict: "session_id,kind", ignoreDuplicates: true },
    );

    // Screen the names against OFAC's list once the LP has their answer, so the
    // download never delays it. Best-effort: the fund manager can run it again
    // from the sanctions check, and a failure here changes nothing for the LP.
    try {
      after(async () => {
        await runOfacScreen(ctx.supabase, ctx.session.id, ctx.session.organization_id, { actor: { kind: "system" } });
      });
    } catch (err) {
      console.error("submitWizardAction could not schedule the OFAC screen", err);
    }

    // Tell the fund manager's team it's waiting for them. Also after the LP has
    // their answer and separate from the screen above, so neither waits on or
    // can stop the other. The notice never throws.
    try {
      const resubmitted = ctx.session.review_state === "changes_requested";
      after(async () => {
        await notifyTeamOfSubmission(ctx.supabase, { sessionId: ctx.session.id, orgId: ctx.session.organization_id, resubmitted });
      });
    } catch (err) {
      console.error("submitWizardAction could not schedule the team notice", err);
    }

    revalidatePath(`/lp/${token}`);
    revalidatePath("/run/onboarding");
    return { ok: true };
  } catch (err) {
    console.error("submitWizardAction threw", err);
    return { ok: false, error: GENERIC };
  }
}
