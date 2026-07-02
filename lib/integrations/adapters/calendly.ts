// lib/integrations/adapters/calendly.ts
// Meeting scheduling dispatch via the Calendly API.
//
// Mock-or-real: with no CALENDLY_API_KEY in the environment the adapter
// operates in mock mode (it describes what a scheduling link would look like
// but does not call Calendly), so the gate → dispatch flow behaves identically
// whether or not the operator has connected Calendly.
//
// When configured, this calls the Calendly v2 REST API to list the user's event
// types and return the first available scheduling URL, which the operator can
// share directly with a counterparty.
import type {
  AdapterModule,
  DispatchAdapter,
  DispatchContext,
  DispatchResult,
} from "../types";

function configured(): boolean {
  return Boolean(process.env.CALENDLY_API_KEY);
}

export const calendlyAdapter: DispatchAdapter = {
  channel: "calendly",
  isConfigured: configured,
  async dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    const target = ctx.target?.name ?? ctx.target?.email ?? "the counterparty";
    const topic = ctx.subject ?? ctx.metadata?.["stepTitle"] as string ?? "meeting";

    // Honour the gateway contract: ctx.connected reflects the org's integration_connections
    // row; process.env.CALENDLY_API_KEY gates the live API path. Both must be true to proceed.
    if (!ctx.connected || !configured()) {
      return {
        ok: true,
        channel: "calendly",
        live: false,
        detail: `Prepared a scheduling request for ${topic} with ${target} (Calendly not connected — share your scheduling link manually).`,
      };
    }

    try {
      const authHeaders = {
        Authorization: `Bearer ${process.env.CALENDLY_API_KEY}`,
        "Content-Type": "application/json",
      };

      // Fetch the current user to get their Calendly URI.
      const meRes = await fetch("https://api.calendly.com/users/me", {
        headers: authHeaders,
        signal: AbortSignal.timeout(8000),
      });
      if (!meRes.ok) throw new Error(`Calendly users/me: ${meRes.status}`);
      const me = await meRes.json() as { resource: { uri: string; scheduling_url: string } };
      const userUri = me.resource.uri;

      // List event types and pick the first active one.
      const etRes = await fetch(
        `https://api.calendly.com/event_types?user=${encodeURIComponent(userUri)}&active=true&count=1`,
        {
          headers: authHeaders,
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!etRes.ok) throw new Error(`Calendly event_types: ${etRes.status}`);
      const etData = await etRes.json() as {
        collection: { scheduling_url: string; name: string }[];
      };

      const eventType = etData.collection[0];
      if (!eventType) {
        // No active event types — fall back to root scheduling URL.
        return {
          ok: true,
          channel: "calendly",
          live: true,
          detail: `Scheduling link ready for ${topic} with ${target}.`,
          reference: me.resource.scheduling_url,
        };
      }

      return {
        ok: true,
        channel: "calendly",
        live: true,
        detail: `Scheduling link ready: "${eventType.name}" for ${topic} with ${target}.`,
        reference: eventType.scheduling_url,
      };
    } catch (err) {
      return {
        ok: false,
        channel: "calendly",
        live: false,
        detail: `Calendly scheduling link could not be retrieved — share your scheduling link manually.`,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

export const calendlyModule: AdapterModule = {
  handles: ["propose_meeting"],
  adapter: calendlyAdapter,
};
