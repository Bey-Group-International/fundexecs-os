// lib/integrations/adapters/docusign.ts
// Docusign dispatch for the signing family — the Tier 3 Capital Map actions
// (sign_document, execute_subdoc, submit_term_sheet).
//
// Tier 3 is never auto-dispatched by the gate; this adapter is the channel used
// AFTER the operator approves, to prepare the envelope for signature. It never
// initiates signing on its own.
//
// Mock-or-real: with no Docusign credentials in the environment the adapter
// operates in mock mode (it prepares the envelope but does not create it), so the
// gate → dispatch flow behaves identically whether or not the operator has
// connected Docusign. The real envelope creation is wired through the connected
// Docusign integration at the marked seam, once OAuth credential plumbing lands.
import type {
  AdapterModule,
  DispatchAdapter,
  DispatchContext,
  DispatchResult,
} from "../types";

function configured(): boolean {
  return Boolean(process.env.DOCUSIGN_ACCESS_TOKEN || process.env.DOCUSIGN_INTEGRATION_KEY);
}

export const docusignAdapter: DispatchAdapter = {
  channel: "docusign",
  isConfigured: configured,
  async dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    const action = ctx.action.replace(/_/g, " ");
    const target = ctx.target?.name ?? ctx.target?.email ?? "the counterparty";

    // The org's own vault credentials (resolved by dispatchAction) count
    // toward "configured" alongside the deploy env, matching the gmail
    // adapter — an org that stored its Docusign token shouldn't be told
    // "not connected".
    const hasOrgCreds = Boolean(
      ctx.secrets?.DOCUSIGN_ACCESS_TOKEN || ctx.secrets?.DOCUSIGN_INTEGRATION_KEY,
    );

    // Per-org connection wins when the caller resolved it; else the env default.
    if (!(ctx.connected ?? (configured() || hasOrgCreds))) {
      return {
        ok: true,
        channel: "docusign",
        live: false,
        detail: `Prepared a ${action} envelope for ${target} (Docusign not connected).`,
      };
    }

    // SEAM: real envelope creation through the connected Docusign integration
    // goes here. This runs only AFTER operator approval — Tier 3 actions are
    // never auto-dispatched by the gate. Until the OAuth credential plumbing is
    // in place, report this honestly as NOT delivered — no envelope was ever
    // created, so claiming "queued" (as this used to) told the operator a
    // signature request went out when it didn't. ok:false is what flips the
    // associated task away from reading "completed". FundExecs' own native
    // e-sign system (lib/signing.ts, /sign/[token]) does not have this gap —
    // prefer routing signing actions there over this Docusign placeholder.
    return {
      ok: false,
      channel: "docusign",
      live: false,
      detail: `${action} envelope for ${target} was not sent for signature — Docusign sending isn't wired up yet.`,
      error: `docusign sending is not yet wired up — no envelope was created for ${target}.`,
    };
  },
};

export const docusignModule: AdapterModule = {
  handles: ["sign_document", "execute_subdoc", "submit_term_sheet"],
  adapter: docusignAdapter,
};
