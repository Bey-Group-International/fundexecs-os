// app/(app)/settings/Connections.tsx
// The "Connections" panel for Settings. It reflects the unified gateway's
// per-org connection state: which channels (Gmail, Docusign, …) this org has
// connected, which fall back to a deploy-wide environment default, and which are
// still waiting on a channel connection. Connect / disconnect run through the gateway server
// actions; the gateway holds any OAuth tokens, so nothing secret is shown here.
import type { IntegrationConnection } from "@/lib/supabase/database.types";
import { integrationCatalog, envConfiguredChannels } from "@/lib/integrations/catalog";
import { ConnectionControls } from "./ConnectionControls";

type ChannelState = "connected_gateway" | "connected_env" | "prepared";

export function Connections({ connections }: { connections: IntegrationConnection[] }) {
  // One row per (org, channel) by the table's unique constraint.
  const rowByChannel = new Map(connections.map((c) => [c.channel, c]));
  const env = envConfiguredChannels();

  return (
    <div className="flex flex-col gap-2">
      {integrationCatalog().map((descriptor) => {
        const row = rowByChannel.get(descriptor.channel);
        const state: ChannelState = row
          ? row.status === "connected"
            ? "connected_gateway"
            : "prepared"
          : env.has(descriptor.channel)
            ? "connected_env"
            : "prepared";
        const connected = state !== "prepared";

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
                    <span className="rounded-full border border-status-success/40 bg-status-success/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-success">
                      Connected
                    </span>
                  ) : state === "connected_env" ? (
                    <span className="rounded-full border border-status-success/40 bg-status-success/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-success">
                      Connected · environment
                    </span>
                  ) : (
                    <span className="rounded-full border border-line bg-surface-0 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                      Prepared only
                    </span>
                  )}
                  {row?.status === "connected" && row.account_label ? (
                    <span className="font-mono text-[10px] text-fg-muted">{row.account_label}</span>
                  ) : null}
                </div>

                {descriptor.capabilities.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {descriptor.capabilities.map((cap) => (
                      <span
                        key={cap.kind}
                        className="rounded-full border border-line bg-surface-0 px-2 py-0.5 text-[10px] text-fg-secondary"
                      >
                        {cap.label}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                    No actions routed
                  </p>
                )}
              </div>

              {/* Connect / disconnect through the gateway. The env fallback is
                  deploy-wide, so it can be pinned off with an explicit row. */}
              <ConnectionControls
                channel={descriptor.channel}
                connected={connected}
                gatewayConnected={state === "connected_gateway"}
              />
            </div>
          </div>
        );
      })}

      {/* The prepared fallback is not a registered channel: any ActionKind that no
          adapter claims is prepared and queued rather than sent. */}
      <div className="rounded-xl border border-dashed border-line bg-surface-1 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-fg-muted" aria-label="prepared only" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-fg-primary">Prepared fallback</span>
              <span className="rounded-full border border-line bg-surface-0 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
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
