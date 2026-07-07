"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type PartyIntent = { party: string; events: number; intent: number };
type Summary = { total: number; active: number; completed: number; replied: number; replyRate: number };
type Dashboard = {
  contacts: { total: number; highConfidence: number; suppressed: number; lists: number };
  campaigns: Summary;
  signals: { total: number; topParties: PartyIntent[] };
  recommendations: string[];
};

function Tile({ label, value, href }: { label: string; value: number | string; href?: string }) {
  const inner = (
    <div className="rounded-xl border border-line/60 bg-surface-1 px-4 py-3 transition hover:border-gold-500/40">
      <div className="text-2xl font-semibold text-gold-300">{value}</div>
      <div className="text-xs uppercase tracking-wide text-ink-400">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default function RelationshipClient() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/relationship/dashboard");
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const body = (await res.json()) as Dashboard;
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
        <h1 className="text-2xl font-semibold text-surface-0">Relationship Center</h1>
        <p className="text-sm text-ink-400">
          Your relationship intelligence at a glance — contacts, campaigns, and live intent, with Earn&apos;s
          recommended next moves.
        </p>
      </header>

      {loading && <div className="text-sm text-ink-400">Loading…</div>}
      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {data && (
        <div className="space-y-6">
          <section className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-ink-400">Network</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="Contacts" value={data.contacts.total} href="/prospecting" />
              <Tile label="High confidence" value={data.contacts.highConfidence} />
              <Tile label="Lists" value={data.contacts.lists} />
              <Tile label="Do-not-contact" value={data.contacts.suppressed} />
            </div>
          </section>

          <section className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-ink-400">Campaigns</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="Enrolled" value={data.campaigns.total} href="/run/campaigns" />
              <Tile label="Active" value={data.campaigns.active} />
              <Tile label="Replied" value={data.campaigns.replied} />
              <Tile label="Reply rate" value={`${data.campaigns.replyRate}%`} />
            </div>
          </section>

          <section className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-ink-400">Live intent</div>
            <div className="overflow-hidden rounded-2xl border border-line/60 bg-surface-1">
              <div className="flex items-center justify-between border-b border-line/60 px-4 py-2.5 text-xs text-ink-400">
                <span>{data.signals.total} engagement event{data.signals.total === 1 ? "" : "s"}</span>
                <Link href="/signals" className="text-gold-300 hover:text-gold-400">
                  View all →
                </Link>
              </div>
              {data.signals.topParties.length === 0 ? (
                <div className="px-4 py-4 text-sm text-ink-400">No identifiable engaging parties yet.</div>
              ) : (
                data.signals.topParties.map((p) => (
                  <div key={p.party} className="flex items-center justify-between border-b border-line/40 px-4 py-2.5 text-sm">
                    <span className="text-surface-0">{p.party}</span>
                    <span className="text-xs text-gold-300">intent {p.intent}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          {data.recommendations.length > 0 && (
            <section className="rounded-2xl border border-gold-500/40 bg-gold-500/5 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-gold-300">Earn recommends</div>
              <ul className="mt-2 space-y-1.5">
                {data.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-2 text-sm text-surface-0">
                    <span className="text-gold-400">→</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
