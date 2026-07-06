"use client";

import { useEffect, useState } from "react";

type Summary = {
  total: number;
  active: number;
  completed: number;
  stopped: number;
  replied: number;
  replyRate: number;
};
type CampaignStat = Summary & { id: string; name: string };
type Analytics = { campaigns: CampaignStat[]; totals: Summary };

function Tile({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="rounded-xl border border-line/60 bg-surface-1 px-4 py-3">
      <div className="text-2xl font-semibold text-gold-300">
        {value}
        {suffix ?? ""}
      </div>
      <div className="text-xs uppercase tracking-wide text-ink-400">{label}</div>
    </div>
  );
}

export default function CampaignsClient() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/relationship/campaigns");
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const body = (await res.json()) as Analytics;
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
        <h1 className="text-2xl font-semibold text-surface-0">Campaigns</h1>
        <p className="text-sm text-ink-400">
          Outreach analytics across your enrolled sequences — enrollments, completions, replies, and reply rate.
        </p>
      </header>

      {loading && <div className="text-sm text-ink-400">Loading…</div>}
      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Tile label="Enrolled" value={data.totals.total} />
            <Tile label="Active" value={data.totals.active} />
            <Tile label="Completed" value={data.totals.completed} />
            <Tile label="Replied" value={data.totals.replied} />
            <Tile label="Reply rate" value={data.totals.replyRate} suffix="%" />
          </div>

          <div className="overflow-hidden rounded-2xl border border-line/60 bg-surface-1">
            <div className="border-b border-line/60 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-400">
              Sequences
            </div>
            {data.campaigns.length === 0 ? (
              <div className="px-4 py-6 text-sm text-ink-400">
                No sequences yet. Build a plan in Prospecting, save it, then enroll ready contacts.
              </div>
            ) : (
              <>
                <div className="hidden grid-cols-12 gap-2 border-b border-line/40 px-4 py-2 text-xs uppercase tracking-wide text-ink-400 sm:grid">
                  <div className="col-span-5">Cadence</div>
                  <div className="col-span-1 text-right">Enrolled</div>
                  <div className="col-span-2 text-right">Active</div>
                  <div className="col-span-1 text-right">Done</div>
                  <div className="col-span-1 text-right">Replied</div>
                  <div className="col-span-2 text-right">Reply rate</div>
                </div>
                {data.campaigns.map((c) => (
                  <div key={c.id} className="grid grid-cols-2 gap-2 border-b border-line/40 px-4 py-3 text-sm sm:grid-cols-12">
                    <div className="col-span-2 font-medium text-surface-0 sm:col-span-5">{c.name}</div>
                    <div className="text-right text-surface-0 sm:col-span-1">{c.total}</div>
                    <div className="text-right text-ink-400 sm:col-span-2">{c.active}</div>
                    <div className="text-right text-ink-400 sm:col-span-1">{c.completed}</div>
                    <div className="text-right text-ink-400 sm:col-span-1">{c.replied}</div>
                    <div className="text-right text-gold-300 sm:col-span-2">{c.replyRate}%</div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
