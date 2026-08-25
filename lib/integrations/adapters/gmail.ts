// lib/integrations/adapters/gmail.ts
// Email dispatch for the outreach / reporting family — the bulk of the
// external-facing (Tier 2) Capital Map actions.
//
// Routes through lib/email.ts, which sends natively from the organization's
// own Google mailbox. An org that has connected Google sends live and from its
// real inbox; one that has not degrades to a saved draft.
import type {
  AdapterModule,
  DispatchAdapter,
  DispatchContext,
  DispatchResult,
} from "../types";
import { sendEmail, escapeHtml } from "@/lib/email";
import { getGoogleAccessToken } from "@/lib/google-oauth";

/**
 * Whether the DEPLOYMENT can send or connect at all. GOOGLE_OAUTH_CLIENT_ID
 * counts here because it enables the connect flow, which is what this predicate
 * drives in the integrations UI. It is deliberately NOT the dispatch gate: an
 * OAuth client proves a deployment can offer "Connect Google", never that any
 * particular org has done so.
 */
function configured(): boolean {
  return Boolean(process.env.GMAIL_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_CLIENT_ID);
}

export const gmailAdapter: DispatchAdapter = {
  channel: "gmail",
  isConfigured: configured,
  async dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    const to = ctx.target?.email;
    const recipient = to ?? ctx.target?.name ?? "the contact";
    // Only an actual credential proves a send can succeed: the org's own
    // (resolved by dispatchAction) or the deploy-wide token. An OAuth client id
    // is not one — treating it as proof would send disconnected orgs down the
    // live path to a guaranteed failure instead of saving them a draft.
    const hasSendableCredential = Boolean(
      ctx.secrets?.GMAIL_ACCESS_TOKEN ||
        ctx.secrets?.GOOGLE_REFRESH_TOKEN ||
        process.env.GMAIL_ACCESS_TOKEN,
    );

    if (!(ctx.connected ?? hasSendableCredential)) {
      return {
        ok: true,
        channel: "gmail",
        live: false,
        detail: `Drafted email to ${recipient} (no mailbox connected — saved as a draft to review).`,
      };
    }

    if (!to) {
      return {
        ok: false,
        channel: "gmail",
        live: false,
        detail: `No email address on file for ${recipient} — send manually.`,
      };
    }

    // Per-org Gmail identity, resolved here rather than by sendEmail because
    // dispatch already holds the org's whole secret set. The minted token comes
    // first for the same reason it does in lib/email.ts: a stored static token
    // expires within the hour and would otherwise shadow the durable one.
    let gmailAccessToken: string | undefined;
    if (ctx.secrets?.GOOGLE_REFRESH_TOKEN) {
      gmailAccessToken =
        (await getGoogleAccessToken(ctx.orgId, ctx.secrets.GOOGLE_REFRESH_TOKEN)) ?? undefined;
    }
    gmailAccessToken ??= ctx.secrets?.GMAIL_ACCESS_TOKEN;

    const escaped = escapeHtml(ctx.body ?? "");
    const result = await sendEmail({
      to: { name: ctx.target?.name ?? recipient, email: to },
      subject: ctx.subject ?? "(no subject)",
      htmlBody: escaped
        ? `<p>${escaped.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`
        : "",
      orgId: ctx.orgId,
      credentials: { gmailAccessToken, fromEmail: ctx.secrets?.FUNDEXECS_FROM_EMAIL },
    });

    if (result.ok) {
      return {
        ok: true,
        channel: result.channel,
        live: true,
        detail: `Email sent to ${recipient} via ${result.channel}.`,
      };
    }

    return {
      ok: false,
      channel: result.channel,
      live: true,
      detail: `Email to ${recipient} could not be delivered. ${result.detail}`,
      error: result.detail,
    };
  },
};

export const gmailModule: AdapterModule = {
  handles: [
    "draft_message",
    "draft_memo",
    "send_outreach",
    "send_intro_request",
    "send_diligence_request",
    "distribute_report",
    "share_materials",
    // Email is the default messaging channel for unified-inbox replies; a reply
    // on a non-email thread (e.g. Slack) is pinned to its channel via the
    // DispatchContext.channel hint instead.
    "draft_reply",
    "send_reply",
  ],
  adapter: gmailAdapter,
};
