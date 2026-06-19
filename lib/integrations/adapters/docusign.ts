// lib/integrations/adapters/docusign.ts
// STUB — Docusign dispatch for the signing family (Tier 3: sign_document,
// execute_subdoc, submit_term_sheet). Tier 3 is never auto-dispatched by the
// gate; this adapter is the channel used AFTER the operator approves, to prepare
// the envelope for signature.
//
// This stub keeps the registry resolvable and the build green; a parallel task
// replaces it with real envelope creation through the connected Docusign
// integration. Implementations must preserve the mock-or-real discipline used by
// the Gmail adapter (return a well-formed mock result when unconfigured).
import type {
  AdapterModule,
  DispatchAdapter,
  DispatchContext,
  DispatchResult,
} from "../types";

export const docusignAdapter: DispatchAdapter = {
  channel: "docusign",
  isConfigured: () => false,
  async dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    const who = ctx.target?.name ? ` for ${ctx.target.name}` : "";
    return {
      ok: true,
      channel: "docusign",
      live: false,
      detail: `Prepared a ${ctx.action.replace(/_/g, " ")} envelope${who} (Docusign not yet wired).`,
    };
  },
};

export const docusignModule: AdapterModule = {
  handles: ["sign_document", "execute_subdoc", "submit_term_sheet"],
  adapter: docusignAdapter,
};
