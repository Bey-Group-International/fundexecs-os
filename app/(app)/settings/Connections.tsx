// app/(app)/settings/Connections.tsx
// The "Connections" panel for Settings. It reflects the unified gateway's
// per-org connection state: which channels (Gmail, Docusign, …) this org has
// connected, which fall back to a deploy-wide environment default, and which are
// still waiting on a channel connection. Connect / disconnect run through the gateway server
// actions; the gateway holds any OAuth tokens, so nothing secret is shown here.
import type { IntegrationConnection } from "@/lib/supabase/database.types";
import { integrationCatalog, envConfiguredChannels } from "@/lib/integrations/catalog";
import { googleOAuthConfigured } from "@/lib/google-oauth";
import { ConnectionControls } from "./ConnectionControls";

type ChannelState = "connected_gateway" | "connected_env" | "prepared";

// The only channel whose "connected" state actually results in a live external
// call today (lib/integrations/adapters/gmail.ts routes through lib/email.ts).
// Every other adapter's connected branch honestly reports a not-delivered
// result rather than calling out — connecting them here changes what the
// Settings badge says, not what dispatch actually does, so the badge for
// those channels says so rather than implying parity with Gmail.
const LIVE_CAPABLE = new Set(["gmail"]);

export function Connections({
  connections,
  connectedChannels,
}: {
  connections: IntegrationConnection[];
  /**
   * The channels whose credentials actually resolve, from the server.
   *
   * Passed in rather than derived here: this component used to read a
   * 'connected' row as proof, which is exactly how a channel with an empty
   * vault came to show a green dot. There is now one resolver and this is its
   * answer.
   */
  connectedChannels: string[];
}) {
  // One row per (org, channel) by the table's unique constraint.
  const rowByChannel = new Map(connections.map((c) => [c.channel, c]));
  const env = envConfiguredChannels();
  const live = new Set(connectedChannels);

  return (
    <div className="flex flex-col gap-2">
      {integrationCatalog().map((descriptor) => {
        const row = rowByChannel.get(descriptor.channel);
        const connected = live.has(descriptor.channel);
        // A row that claims connection while nothing backs it. These are what
        // the old Connect button wrote, and saying so is more use than showing
        // the channel as merely unconnected — it tells the member the thing
        // they already pressed did not do what it appeared to.
        const claimedButUnbacked = row?.status === "connected" && !connected;
        const state: ChannelState = !connected
          ? "prepared"
          : env.has(descriptor.channel)
            ? "connected_env"
            : "connected_gateway";

        return (
          <div key={descriptor.channel} className="rounded-xl border border-line bg-surface-1 p-4">
            <div className="flex items-start gap-3">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  connected ? "bg-status-success" : "bg-fg-muted"
                }`}
                aria-label={connected ? "connected" : "prepared only"}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-fg-primary">{descriptor.label}</span>
                  {state === "connected_gateway" ? (
                    <span className="rounded-full border border-status-success/40 bg-status-success/10 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-status-success">
                      Connected
                    </span>
                  ) : state === "connected_env" ? (
                    <span className="rounded-full border border-status-success/40 bg-status-success/10 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-status-success">
                      Connected · environment
                    </span>
                  ) : claimedButUnbacked ? (
                    <span className="rounded-full border border-status-warning/40 bg-status-warning/10 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-status-warning">
                      Setup incomplete
                    </span>
                  ) : (
                    <span className="rounded-full border border-line bg-surface-0 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
                      Prepared only
                    </span>
                  )}
                  {/* Only an account label from a real grant. The placeholder
                      the old Connect button wrote is not an account, and
                      showing it beside a channel is what made it look like one. */}
                  {connected && row?.account_label ? (
                    <span className="font-mono text-[11px] text-fg-muted">{row.account_label}</span>
                  ) : null}
                </div>

                {claimedButUnbacked ? (
                  <p className="mt-2 text-xs leading-snug text-status-warning">
                    This was marked connected, but no credentials for it exist — so nothing
                    can send through it. Add them below, or connect the provider directly.
                  </p>
                ) : null}

                {connected && !LIVE_CAPABLE.has(descriptor.channel) ? (
                  <p className="mt-1.5 text-[11px] leading-snug text-fg-muted">
                    Sending isn&apos;t live for this channel yet — actions will be prepared, not delivered.
                  </p>
                ) : null}

                {descriptor.capabilities.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {descriptor.capabilities.map((cap) => (
                      <span
                        key={cap.kind}
                        className="rounded-full border border-line bg-surface-0 px-2 py-0.5 text-[11px] text-fg-secondary"
                      >
                        {cap.label}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
                    No actions routed
                  </p>
                )}
              </div>

              {/* Connect / disconnect through the gateway. The env fallback is
                  deploy-wide, so it can be pinned off with an explicit row. */}
              <ConnectionControls
                channel={descriptor.channel}
                connected={connected}
                revocable={connected}
                // The channels with a REAL consent screen, when the deploy has
                // a Google OAuth client. Everything else points at the vault
                // fields, because that is where its credential comes from.
                oauthHref={oauthStartFor(descriptor.channel)}
              />
            </div>
          </div>
        );
      })}

      {/* Professional Network — a data-INPUT integration, not a dispatch
          channel: sources feed the Capital Relationship Graph rather than
          sending anything out. Backend connectors (Google Contacts, official
          LinkedIn API) surface here as they become available; manual entry,
          LinkedIn profile URLs, and the CSV fallback are always available at
          /network. */}
      <div className="rounded-xl border border-line bg-surface-1 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-status-success" aria-label="import available" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-fg-primary">Professional Network</span>
              <span className="rounded-full border border-status-success/40 bg-status-success/10 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-status-success">
                Import available
              </span>
              <span className="rounded-full border border-line bg-surface-0 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
                Data input
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-fg-muted">
              LinkedIn profile URLs, manual entry, and CSV export import are live today; Google
              Contacts and official LinkedIn API sync activate when provider access is configured.
              No scraping — every pathway is user-initiated and permission-first.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                "Import professional profiles",
                "Map relationship graph",
                "Detect warm intro paths",
                "Recommend capital contacts",
                "Generate outreach drafts",
              ].map((cap) => (
                <span key={cap} className="rounded-full border border-line bg-surface-0 px-2 py-0.5 text-[11px] text-fg-secondary">
                  {cap}
                </span>
              ))}
            </div>
          </div>
          <a
            href="/network"
            className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs text-fg-secondary transition-colors hover:border-accent/50 hover:text-accent"
          >
            Open Network
          </a>
        </div>
      </div>

      {/* The prepared fallback is not a registered channel: any ActionKind that no
          adapter claims is prepared and queued rather than sent. */}
      <div className="rounded-xl border border-dashed border-line bg-surface-1 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-fg-muted" aria-label="prepared only" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-fg-primary">Prepared fallback</span>
              <span className="rounded-full border border-line bg-surface-0 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
                Not sent
              </span>
            </div>
            <p className="mt-2 text-xs leading-snug text-fg-secondary">
              Actions no channel above claims route here and are prepared/queued rather than sent.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The provider consent screen for a channel, when the deploy has one. */
function oauthStartFor(channel: string): string | undefined {
  if (!googleOAuthConfigured()) return undefined;
  if (channel === "gmail") return "/api/oauth/google/start";
  // Per-member rather than per-org, but it is still the real grant and still
  // the thing that makes the channel reachable.
  if (channel === "google_calendar") return "/api/oauth/google/calendar/start";
  return undefined;
}
