"use client";

import { useEffect, useState } from "react";

type PartyIntent = { party: string; events: number; lastAt: string; intent: number };
type Totals = { deal_share: number; data_room: number; marketplace: number; portal: number; total: number };
type Signals = { totals: Totals; parties: PartyIntent[] };

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line/60 bg-surface-1 px-4 py-3">
      <div className="text-2xl font-semibold text-gold-300">{value}</div>
      <div className="text-xs uppercase tracking-wide text-ink-400">{label}</div>
    </div>
  );
}

function intentClass(intent: number): string {
  if (intent >= 70) return "bg-gold-500/20 text-gold-300 border-gold-500/50";
  if (intent >= 40) return "bg-surface-2 text-gold-400 border-line";
  return "bg-surface-2 text-ink-400 border-line/60";
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
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-surface-0">Intent Signals</h1>
        <p className="text-sm text-ink-400">
          Who&apos;s engaging with your deal shares, data room, marketplace listings, and investor portal —
          warm, high-intent parties to route into outreach.
        </p>
      </header>

      {loading && <div className="text-sm text-ink-400">Loading…</div>}
      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
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
            <div className="border-b border-line/60 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-400">
              Most engaged parties
            </div>
            {data.parties.length === 0 ? (
              <div className="px-4 py-6 text-sm text-ink-400">
                No identifiable engaging parties yet. Deal-share views with a named viewer appear here first.
              </div>
            ) : (
              data.parties.map((p) => (
                <div key={p.party} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line/40 px-4 py-3 text-sm">
                  <div className="min-w-[12rem] flex-1 font-medium text-surface-0">{p.party}</div>
                  <div className="w-24 text-center">
                    <div className="text-xs text-ink-400">Events</div>
                    <div className="text-surface-0">{p.events}</div>
                  </div>
                  <div className="w-28 text-center">
                    <div className="text-xs text-ink-400">Last seen</div>
                    <div className="text-ink-400">{fmtDate(p.lastAt)}</div>
                  </div>
                  <div className="w-20 text-right">
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
