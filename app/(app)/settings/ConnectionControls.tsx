"use client";

import { useTransition } from "react";
import { connectIntegration, disconnectIntegration } from "./connections-actions";

// Connect / disconnect a single integration through the gateway. A thin client
// wrapper so the button can show a pending state; the actual work runs in the
// server actions (the gateway brokers auth, RLS gates the write).
//
// Channels with a REAL hosted-auth flow set `oauthHref` (gmail →
// /api/oauth/google/start): connecting navigates to the provider's consent
// screen instead of minting the gateway's placeholder connection. Disconnect
// still goes through the gateway action (the revoked row wins either way).
export function ConnectionControls({
  channel,
  connected,
  gatewayConnected,
  oauthHref,
}: {
  channel: string;
  // Live for this org (gateway row or env fallback).
  connected: boolean;
  // Specifically connected via a gateway row (vs. the deploy-wide env default).
  gatewayConnected: boolean;
  // Real OAuth entry point for this channel, when the deploy has one configured.
  oauthHref?: string;
}) {
  const [pending, startTransition] = useTransition();
  const action = connected ? disconnectIntegration : connectIntegration;
  const label = gatewayConnected ? "Disconnect" : connected ? "Override off" : "Connect";

  if (!connected && oauthHref) {
    return (
      <a
        href={oauthHref}
        className="shrink-0 rounded-lg border border-gold-500/40 bg-gold-500/10 px-2.5 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20"
      >
        Connect
      </a>
    );
  }

  return (
    <form
      action={(formData) => startTransition(async () => void (await action(formData)))}
      className="shrink-0"
    >
      <input type="hidden" name="channel" value={channel} />
      <button
        type="submit"
        disabled={pending}
        className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
          connected
            ? "border-line bg-surface-2 text-fg-secondary hover:bg-surface-3"
            : "border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20"
        }`}
      >
        {pending ? "…" : label}
      </button>
    </form>
  );
}
