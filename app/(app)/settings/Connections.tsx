// app/(app)/settings/Connections.tsx
// Read-only "Connections" panel for Settings. It reflects the dispatch layer's
// wiring: which channels (Gmail, Docusign, …) have real credentials and which
// are running in mock mode. It makes NO writes and offers no connect/OAuth flow
// — it only mirrors each adapter's isConfigured() state so the operator can see
// at a glance where the gate → dispatch loop will reach the outside world vs.
// where it will prepare/queue without sending.
import { ADAPTERS } from "@/lib/integrations/adapters";

// Turn an ActionKind ("send_diligence_request") into a readable label
// ("Send diligence request"). Mirrors how the adapters declare their handles in
// snake_case while the UI speaks prose.
function humanizeKind(kind: string): string {
  const words = kind.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function Connections() {
  return (
    <section className="mt-8">
      <header className="mb-3">
        <h2 className="font-mono text-xs uppercase tracking-wider text-fg-muted">Connections</h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Dispatch channels carry approved external actions to the outside world. A channel that is
          connected sends for real; an unconnected one still runs in mock mode — the action is
          prepared and queued, not sent — so the gate → dispatch loop works end-to-end before any
          provider is wired up.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        {ADAPTERS.map(({ adapter, handles }) => {
          const live = adapter.isConfigured();
          return (
            <div key={adapter.channel} className="rounded-xl border border-line bg-surface-1 p-4">
              <div className="flex items-start gap-3">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    live ? "bg-status-success" : "bg-fg-muted"
                  }`}
                  aria-label={live ? "connected" : "mock mode"}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium capitalize text-fg-primary">
                      {adapter.channel}
                    </span>
                    {live ? (
                      <span className="rounded-full border border-status-success/40 bg-status-success/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-success">
                        Connected
                      </span>
                    ) : (
                      <span className="rounded-full border border-line bg-surface-0 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                        Mock mode
                      </span>
                    )}
                  </div>
                  {handles.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {handles.map((kind) => (
                        <span
                          key={kind}
                          className="rounded-full border border-line bg-surface-0 px-2 py-0.5 text-[10px] text-fg-secondary"
                        >
                          {humanizeKind(kind)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                      No actions routed
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* The mock fallback is not a registered adapter: any ActionKind that no
            module above claims routes to the built-in "mock" channel. We surface
            it here so the catch-all behaviour is visible alongside the real
            channels. */}
        <div className="rounded-xl border border-dashed border-line bg-surface-1 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-fg-muted" aria-label="mock mode" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-fg-primary">Mock fallback</span>
                <span className="rounded-full border border-line bg-surface-0 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                  Mock mode
                </span>
              </div>
              <p className="mt-2 text-xs leading-snug text-fg-secondary">
                Actions no channel above claims route here and are prepared/queued rather than sent.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
