"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AskEarnButton } from "@/components/AskEarnButton";
import type { PulseItem, PulseItemKind, PulseRun } from "@/lib/supabase/database.types";
import { addPulseItem, dismissPulseItem, refreshPulse } from "./actions";

const KIND_LABEL: Record<PulseItemKind, string> = {
  deal: "Deal",
  investment: "Investment",
  investor: "Investor",
};

type Filter = "all" | PulseItemKind;

function fmtDate(iso: string | null): string {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? "—" : new Date(ms).toISOString().slice(0, 10);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function recordHref(item: PulseItem): string | null {
  if (!item.added_record_id) return null;
  return item.added_record_type === "investor" ? `/investor/${item.added_record_id}` : `/deal/${item.added_record_id}`;
}

function PulseCard({ item, onDone }: { item: PulseItem; onDone: (msg: string) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    start(async () => {
      const r = await addPulseItem(item.id);
      if (r.ok) onDone(r.existed ? `${item.entity_name} was already in your pipeline — linked.` : `Added ${item.entity_name} to your pipeline.`);
      else setError(r.error);
    });
  }

  function dismiss() {
    setError(null);
    start(async () => {
      const r = await dismissPulseItem(item.id);
      if (r.ok) onDone(`Dismissed ${item.entity_name}. Pulse will steer away from similar items.`);
      else setError(r.error ?? "Couldn't dismiss.");
    });
  }

  return (
    <article className="fx-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded border border-line/60 bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
              {KIND_LABEL[item.kind]}
            </span>
            {item.fit_score !== null ? (
              <span className="font-mono text-[11px] text-gold-300">fit {item.fit_score}</span>
            ) : null}
            <span className="font-mono text-[11px] text-fg-muted">{fmtDate(item.created_at)}</span>
          </div>
          <h2 className="mt-1.5 text-sm font-semibold text-fg-primary">{item.entity_name}</h2>
          <p className="mt-0.5 text-sm text-fg-secondary">{item.headline}</p>
        </div>
      </div>
      {item.take ? <p className="mt-3 text-sm text-fg-primary">{item.take}</p> : null}
      {item.why_it_fits ? (
        <p className="mt-1.5 text-xs text-fg-secondary">
          <span className="font-medium text-fg-primary">Why it fits: </span>
          {item.why_it_fits}
        </p>
      ) : null}
      {item.source_url ? (
        <a
          href={item.source_url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-2 inline-block max-w-full truncate text-xs text-gold-300 hover:underline"
        >
          {item.source_title || hostOf(item.source_url)} ↗
        </a>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={add}
          disabled={pending}
          className="rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-60"
        >
          Add to pipeline
        </button>
        <AskEarnButton type="pulse" id={item.id} name={item.entity_name} variant="secondary" />
        <button
          type="button"
          onClick={dismiss}
          disabled={pending}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-surface-2 hover:text-fg-primary disabled:opacity-60"
        >
          Dismiss
        </button>
        {error ? <span className="text-xs text-status-danger">{error}</span> : null}
      </div>
    </article>
  );
}

export default function PulseClient({
  items,
  added,
  lastRun,
  searchesLeft,
  searchCap,
}: {
  items: PulseItem[];
  added: PulseItem[];
  lastRun: PulseRun | null;
  searchesLeft: number;
  searchCap: number;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();

  const shown = filter === "all" ? items : items.filter((i) => i.kind === filter);
  const counts = {
    all: items.length,
    deal: items.filter((i) => i.kind === "deal").length,
    investment: items.filter((i) => i.kind === "investment").length,
    investor: items.filter((i) => i.kind === "investor").length,
  };

  function refresh() {
    setNotice(null);
    startRefresh(async () => {
      const r = await refreshPulse();
      if (r.status === "ok") {
        setNotice(r.items ? `Found ${r.items} new ${r.items === 1 ? "item" : "items"}.` : "Nothing new that fits right now.");
      } else {
        setNotice(r.detail ?? "Pulse couldn't refresh.");
      }
    });
  }

  const lastNote =
    lastRun && lastRun.status !== "ok" && lastRun.detail
      ? lastRun.detail
      : lastRun
        ? `Last scan ${fmtDate(lastRun.created_at)}.`
        : "No scans yet — Pulse runs daily once your thesis or mandate is set.";

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-fg-primary">Market Pulse</h1>
          <p className="mt-1 max-w-prose text-sm text-fg-secondary">
            Deals, investments, and investors that fit your mandate — found on the live web each day, with Earn&apos;s take and the source.
          </p>
          <p className="mt-1 text-xs text-fg-muted">{lastNote}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing || searchesLeft === 0}
            className="rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-60"
          >
            {refreshing ? "Scanning…" : "Refresh"}
          </button>
          <span className="font-mono text-[11px] text-fg-muted">
            {searchesLeft}/{searchCap} web searches left today
          </span>
        </div>
      </header>

      {notice ? (
        <p className="mb-4 rounded-md border border-line/60 bg-surface-1 px-3 py-2 text-sm text-fg-secondary" role="status">
          {notice}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter findings">
        {(["all", "deal", "investment", "investor"] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`rounded-md border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider transition ${
              filter === f
                ? "border-gold-500/60 bg-gold-500/10 text-gold-300"
                : "border-line/50 bg-surface-2/60 text-fg-muted hover:text-fg-primary"
            }`}
          >
            {f === "all" ? "All" : `${KIND_LABEL[f]}s`} · {counts[f]}
          </button>
        ))}
      </div>

      {shown.length ? (
        <div className="flex flex-col gap-3">
          {shown.map((item) => (
            <PulseCard key={item.id} item={item} onDone={setNotice} />
          ))}
        </div>
      ) : (
        <p className="fx-card p-6 text-sm text-fg-secondary">
          {items.length ? "Nothing in this filter." : "No open findings. New ones arrive with the next daily scan, or hit Refresh."}
        </p>
      )}

      {added.length ? (
        <section className="mt-8">
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">Recently added to pipeline</h2>
          <ul className="flex flex-col gap-1.5">
            {added.map((item) => {
              const href = recordHref(item);
              return (
                <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-fg-secondary">
                    <span className="text-fg-primary">{item.entity_name}</span> · {item.headline}
                  </span>
                  {href ? (
                    <Link href={href} className="shrink-0 text-xs text-gold-300 hover:underline">
                      Open {item.added_record_type === "investor" ? "investor" : "deal"} →
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
