// lib/integrations/adapters/finance.ts
// The finance channels the Unified Inbox adds to the dispatch layer: Xero
// (accounting) and Jax (payments). They follow the exact mock-or-real
// discipline as Gmail, Docusign, and the inbox booking/messaging/video channels
// — with no provider credentials present, the adapter prepares a well-formed
// result rather than failing, so the gate -> dispatch -> Outbox loop is fully
// observable before any OAuth plumbing lands.
//
// Finance is read-only ingest to start: a thread's acting move (approve a bill,
// reconcile, pay) is reviewed in the provider, so neither channel is the DEFAULT
// route for any ActionKind (handles: []). They are reachable only via the
// DispatchContext.channel hint — the seam through which a future two-way action
// pinned to a Xero/Jax thread would resolve here.
import type { ActionKind } from "@/lib/gates";
import type {
  AdapterModule,
  DispatchAdapter,
  DispatchContext,
  DispatchResult,
} from "../types";

interface FinanceChannelSpec {
  channel: string;
  // Any of these env vars present => real credentials are configured.
  envVars: string[];
  // ActionKinds this channel is the DEFAULT route for. Empty for now — finance
  // is read-only ingest, reached only via the DispatchContext.channel hint.
  handles: ActionKind[];
  // Prose describing the prepared (mock) outcome.
  prepared: (target: string) => string;
  // Prose describing the not-yet-delivered outcome for a channel the org has
  // connected but that has no real provider call wired up yet.
  notDelivered: (target: string) => string;
}

function makeModule(spec: FinanceChannelSpec): AdapterModule {
  const configured = () => spec.envVars.some((v) => Boolean(process.env[v]));

  const adapter: DispatchAdapter = {
    channel: spec.channel,
    isConfigured: configured,
    async dispatch(ctx: DispatchContext): Promise<DispatchResult> {
      const target = ctx.target?.name ?? ctx.target?.email ?? "the counterparty";
      // Per-org connection wins when the caller resolved it; else the env default.
      if (!(ctx.connected ?? configured())) {
        return {
          ok: true,
          channel: spec.channel,
          live: false,
          detail: spec.prepared(target),
        };
      }
      // SEAM: the real provider call goes here once OAuth credential plumbing
      // lands. Until then, report this honestly as NOT delivered — there is no
      // queue or worker that will ever push it through, so claiming "queued"
      // (as this used to) told the operator an action went out when nothing
      // reached the provider. ok:false is what flips the associated task away
      // from reading "completed".
      return {
        ok: false,
        channel: spec.channel,
        live: false,
        detail: spec.notDelivered(target),
        error: `${spec.channel} sending is not yet wired up — nothing was delivered to ${target}.`,
      };
    },
  };

  return { handles: spec.handles, adapter };
}

export const xeroModule = makeModule({
  channel: "xero",
  envVars: ["XERO_ACCESS_TOKEN", "XERO_CLIENT_ID"],
  handles: [], // read-only ingest — reached only via the channel hint
  prepared: (t) => `Prepared a Xero sync for ${t} (Xero not connected — review in the provider).`,
  notDelivered: (t) => `Xero action for ${t} was not sent — Xero sending isn't wired up yet.`,
});

export const jaxModule = makeModule({
  channel: "jax",
  envVars: ["JAX_ACCESS_TOKEN", "JAX_API_KEY"],
  handles: [], // read-only ingest — reached only via the channel hint
  prepared: (t) => `Prepared a Jax sync for ${t} (Jax not connected — review in the provider).`,
  notDelivered: (t) => `Jax action for ${t} was not sent — Jax sending isn't wired up yet.`,
});

export const FINANCE_MODULES: AdapterModule[] = [xeroModule, jaxModule];
