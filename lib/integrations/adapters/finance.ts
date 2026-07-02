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
  // Prose describing the queued (configured-but-not-yet-wired) outcome.
  queued: (target: string) => string;
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
      // lands. Until then we return a configured-but-queued result rather than
      // calling an external API from a server action — the contract stays honest
      // and the loop stays observable.
      return {
        ok: true,
        channel: spec.channel,
        live: false,
        detail: spec.queued(target),
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
  queued: (t) => `Queued a Xero action for ${t} via connected Xero.`,
});

export const jaxModule = makeModule({
  channel: "jax",
  envVars: ["JAX_ACCESS_TOKEN", "JAX_API_KEY"],
  handles: [], // read-only ingest — reached only via the channel hint
  prepared: (t) => `Prepared a Jax sync for ${t} (Jax not connected — review in the provider).`,
  queued: (t) => `Queued a Jax action for ${t} via connected Jax.`,
});

export const FINANCE_MODULES: AdapterModule[] = [xeroModule, jaxModule];
