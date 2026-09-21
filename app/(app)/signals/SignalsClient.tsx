"use client";

import { useEffect, useState } from "react";

type PartyIntent = { party: string; events: number; lastAt: string; intent: number };
type Totals = { deal_share: number; data_room: number; marketplace: number; portal: number; total: number };
type Signals = { totals: Totals; parties: PartyIntent[] };

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line/60 bg-surface-1 px-4 py-3">
      <div className="text-2xl font-semibold text-gold-300">{value}</div>
      <div className="text-xs uppercase tracking-[0.16em] text-fg-muted">{label}</div>
    </div>
  );
}

function intentClass(intent: number): string {
  if (intent >= 70) return "bg-gold-500/20 text-gold-300 border-gold-500/50";
  if (intent >= 40) return "bg-surface-2 text-gold-300 border-line";
  return "bg-surface-2 text-fg-secondary border-line/60";
}

function fmtDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toISOString().slice(0, 10);
}

export default function SignalsClient() {
  const [data, setData] = useState<Signals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/relationship/signals");
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const body = (await res.json()) as Signals;
        if (live) setData(body);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-5 sm:space-y-6 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-fg-primary">Intent Signals</h1>
        <p className="text-sm text-fg-secondary">
          Who&apos;s engaging with your deal shares, data room, marketplace listings, and investor portal —
          warm, high-intent parties to route into outreach.
        </p>
      </header>

      {loading && <div className="text-sm text-fg-muted">Loading…</div>}
      {error && (
        <div className="rounded-xl border border-status-danger/40 bg-status-danger/[0.08] px-4 py-3 text-sm text-status-danger">{error}</div>
      )}

      {data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Tile label="Total events" value={data.totals.total} />
            <Tile label="Deal-share views" value={data.totals.deal_share} />
            <Tile label="Data-room views" value={data.totals.data_room} />
            <Tile label="Marketplace" value={data.totals.marketplace} />
            <Tile label="Portal views" value={data.totals.portal} />
          </div>

          <div className="overflow-hidden rounded-2xl border border-line/60 bg-surface-1">
            <div className="border-b border-line/60 px-4 py-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-fg-muted">
              Most engaged parties
            </div>
            {data.parties.length === 0 ? (
              <div className="px-4 py-6 text-sm text-fg-muted">
                No identifiable engaging parties yet. Deal-share views with a named viewer appear here first.
              </div>
            ) : (
              data.parties.map((p) => (
                <div key={p.party} className="grid gap-3 border-b border-line/40 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_6rem_7rem_5rem] sm:items-center">
                  <div className="min-w-0 break-words font-medium text-fg-primary">{p.party}</div>
                  <div className="flex items-center justify-between gap-3 sm:block sm:text-center">
                    <div className="text-xs text-fg-muted">Events</div>
                    <div className="font-medium text-fg-primary">{p.events}</div>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:block sm:text-center">
                    <div className="text-xs text-fg-muted">Last seen</div>
                    <div className="text-fg-secondary">{fmtDate(p.lastAt)}</div>
                  </div>
                  <div className="text-left sm:text-right">
                    <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${intentClass(p.intent)}`}>
                      {p.intent}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
