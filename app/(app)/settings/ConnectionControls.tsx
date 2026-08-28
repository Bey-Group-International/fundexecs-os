"use client";

import { useTransition } from "react";
import { disconnectIntegration } from "./connections-actions";

/**
 * Connect / disconnect a single integration.
 *
 * Connecting always points at something that actually produces a credential:
 * either the provider's own consent screen (`oauthHref`) or the organization
 * credentials panel further down the page. It no longer writes a gateway row.
 *
 * That row used to be what "Connect" did — status 'connected' with a
 * placeholder account label and no handshake at all — which turned a channel
 * green with nothing behind it. A button whose only effect is to make the UI
 * claim something untrue is worse than no button.
 *
 * Disconnect still goes through the gateway action: a revoked row overrides
 * real credentials, and that direction was never the problem.
 */
export function ConnectionControls({
  channel,
  connected,
  revocable,
  oauthHref,
}: {
  channel: string;
  /** Live for this org, because credentials for it actually resolve. */
  connected: boolean;
  /** Whether there is anything to turn off — i.e. it is currently connected. */
  revocable: boolean;
  /** The provider's consent screen, when this channel has one configured. */
  oauthHref?: string;
}) {
  const [pending, startTransition] = useTransition();

  if (!connected) {
    // Where the credential actually comes from. An OAuth channel goes to the
    // provider; everything else goes to the vault fields on this page.
    const href = oauthHref ?? "#org-credentials";
    return (
      <a
        href={href}
        className="shrink-0 rounded-lg border border-gold-500/40 bg-gold-500/10 px-2.5 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20"
      >
        {oauthHref ? "Connect" : "Add credentials"}
      </a>
    );
  }

  if (!revocable) return null;

  return (
    <form
      action={(formData) => startTransition(async () => void (await disconnectIntegration(formData)))}
      className="shrink-0"
    >
      <input type="hidden" name="channel" value={channel} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-fg-secondary transition hover:bg-surface-3 disabled:opacity-50"
      >
        {pending ? "…" : "Disconnect"}
      </button>
    </form>
  );
}
