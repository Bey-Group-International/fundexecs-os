// lib/integrations/adapters/gmail.ts
// Email dispatch for the outreach / reporting family — the bulk of the
// external-facing (Tier 2) Capital Map actions.
//
// Routes through lib/email.ts which chains: Gmail OAuth (GMAIL_ACCESS_TOKEN) →
// Resend (RESEND_API_KEY) → silent fallback. The adapter is native-first:
// Resend alone is sufficient for live sends; Gmail OAuth upgrades it to
// "from your inbox" when connected.
import type {
  AdapterModule,
  DispatchAdapter,
  DispatchContext,
  DispatchResult,
} from "../types";
import { sendEmail, escapeHtml } from "@/lib/email";

function configured(): boolean {
  return Boolean(
    process.env.GMAIL_ACCESS_TOKEN ||
    process.env.GOOGLE_OAUTH_CLIENT_ID ||
    process.env.RESEND_API_KEY,
  );
}

export const gmailAdapter: DispatchAdapter = {
  channel: "gmail",
  isConfigured: configured,
  async dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    const to = ctx.target?.email;
    const recipient = to ?? ctx.target?.name ?? "the contact";

    if (!(ctx.connected ?? configured())) {
      return {
        ok: true,
        channel: "gmail",
        live: false,
        detail: `Drafted email to ${recipient} (email not connected — saved as a draft to review).`,
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

    const escaped = escapeHtml(ctx.body ?? "");
    const result = await sendEmail({
      to: { name: ctx.target?.name ?? recipient, email: to },
      subject: ctx.subject ?? "(no subject)",
      htmlBody: escaped
        ? `<p>${escaped.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`
        : "",
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
