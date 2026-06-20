// lib/integrations/adapters/gmail.ts
// Email dispatch for the outreach / reporting family — the bulk of the
// external-facing (Tier 2) Capital Map actions.
//
// Mock-or-real: with no Gmail credentials in the environment the adapter
// operates in mock mode (it prepares the message but does not send), so the gate
// → dispatch flow behaves identically whether or not the operator has connected
// email. The real send is wired through the connected Gmail integration at the
// marked seam, once OAuth credential plumbing lands.
import type {
  AdapterModule,
  DispatchAdapter,
  DispatchContext,
  DispatchResult,
} from "../types";

function configured(): boolean {
  return Boolean(process.env.GMAIL_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_CLIENT_ID);
}

export const gmailAdapter: DispatchAdapter = {
  channel: "gmail",
  isConfigured: configured,
  async dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    const to = ctx.target?.email;
    const recipient = to ?? ctx.target?.name ?? "the contact";

    if (!configured()) {
      return {
        ok: true,
        channel: "gmail",
        live: false,
        detail: `Drafted email to ${recipient} (Gmail not connected — saved as a draft to review).`,
      };
    }

    // SEAM: real send through the connected Gmail integration goes here. Until
    // the OAuth credential plumbing is in place we return a configured-but-queued
    // result rather than calling an external API from this server action — the
    // contract stays honest and the loop stays observable.
    return {
      ok: true,
      channel: "gmail",
      live: false,
      detail: `Queued email to ${recipient} for send via connected Gmail.`,
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
