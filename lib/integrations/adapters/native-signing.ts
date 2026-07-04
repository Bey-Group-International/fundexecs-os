// lib/integrations/adapters/native-signing.ts
// Native e-sign dispatch for the Tier-3 signing family (sign_document,
// execute_subdoc, submit_term_sheet) — routes to FundExecs' own
// signing_envelopes system (lib/signing.ts, /envelopes, /sign/[token])
// instead of the DocuSign placeholder that could never actually send.
//
// Tier 3 is never auto-dispatched by the gate; this adapter runs only AFTER
// the operator approves. Even then it stops at a DRAFT: the envelope is
// created with the counterparty as recipient and the drafted content as the
// document body, and the operator reviews, places fields, and sends from the
// wizard. A capital-binding signature request never leaves without a human
// pressing send — that is the point of the tier.
//
// Always available (no external credentials). When it cannot persist a draft
// (no Supabase in context, a system actor with no principal row, or no
// recipient email yet), it degrades honestly: live:false with a link into the
// wizard, never a claim that an envelope exists.
import type {
  AdapterModule,
  DispatchAdapter,
  DispatchContext,
  DispatchResult,
} from "../types";
import { createEnvelope } from "@/lib/signing";
import { getAppUrl } from "./app-url";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actionLabel(ctx: DispatchContext): string {
  return ctx.action.replace(/_/g, " ");
}

export const nativeSigningAdapter: DispatchAdapter = {
  channel: "native_signing",
  isConfigured: () => true,
  async dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    const target = ctx.target?.name ?? ctx.target?.email ?? "the counterparty";
    const title = ctx.subject ?? `${actionLabel(ctx)} — ${target}`;

    // Persisting a draft needs a DB client, a real principal to own the
    // envelope (signing_envelopes.created_by), and a recipient address.
    // Missing any of those, hand back the wizard instead of pretending.
    const canPersist =
      Boolean(ctx.supabase) && UUID_RE.test(ctx.actorId) && Boolean(ctx.target?.email);

    if (!canPersist) {
      return {
        ok: true,
        channel: "native_signing",
        live: false,
        detail: `Envelope for "${title}" prepared — open the e-sign wizard to add the document, recipient, and send.`,
        reference: `${getAppUrl()}/envelopes/new`,
      };
    }

    const result = await createEnvelope({
      supabase: ctx.supabase!,
      orgId: ctx.orgId,
      createdBy: ctx.actorId,
      title,
      message: ctx.body,
      // The drafted content becomes the document body when the action carries
      // one; otherwise a stub the operator replaces in the wizard.
      documentContent:
        ctx.body ?? `${title}\n\n(Replace this draft with the document to be signed.)`,
      recipients: [
        {
          name: ctx.target?.name ?? ctx.target!.email!,
          email: ctx.target!.email!,
        },
      ],
    });

    if (!result.ok) {
      // Honest failure — no envelope means the task must not read as done.
      return {
        ok: false,
        channel: "native_signing",
        live: false,
        detail: `Could not create the envelope for ${target}: ${result.detail}.`,
        error: result.error ?? result.detail,
      };
    }

    return {
      ok: true,
      channel: "native_signing",
      live: true,
      detail: `Draft envelope "${title}" created for ${target} in native e-sign. Review it, place signature fields, and send.`,
      reference: `${getAppUrl()}/envelopes/${result.envelopeId}`,
    };
  },
};

export const nativeSigningModule: AdapterModule = {
  handles: ["sign_document", "execute_subdoc", "submit_term_sheet"],
  adapter: nativeSigningAdapter,
};
