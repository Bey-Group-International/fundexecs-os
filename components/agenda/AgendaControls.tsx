"use client";

// components/agenda/AgendaControls.tsx — interactive deadlines board.
//
// Receives the flat, serializable AgendaItem[] from the server board and owns
// the filtering + bucketing on the client. Filter chips narrow by kind and
// severity plus an "Overdue only" toggle; the surviving items are re-grouped
// (via the LEAF-PURE helpers in lib/agenda — no server imports) and rendered
// with the same row markup as the server board. Each row carries a small
// "Have Earn chase this" button that routes the item into a session.
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  groupAgenda,
  relativeDue,
  type AgendaItem,
  type AgendaKind,
} from "@/lib/agenda-view";
import type { RiskSeverity } from "@/lib/supabase/database.types";
import { chaseAgendaItem, type ChaseResult } from "./actions";

const KIND_LABEL: Record<AgendaKind, string> = {
  diligence: "Diligence",
  capital: "Capital",
  deal: "Deal",
};

const KIND_ORDER: AgendaKind[] = ["diligence", "capital", "deal"];

const SEVERITY_ORDER: RiskSeverity[] = ["critical", "high", "medium", "low"];

const SEVERITY_LABEL: Record<RiskSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Dot tone: red for overdue/critical, amber for soon/high, gold otherwise. */
function dotClass(item: AgendaItem, overdue: boolean): string {
  if (overdue || item.severity === "critical") return "bg-status-danger";
  if (item.severity === "high") return "bg-status-warning";
  return "bg-gold-400";
}

function chipClass(active: boolean): string {
  return `rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition ${
    active
      ? "border-gold-500/40 bg-gold-500/10 text-gold-300"
      : "border-line bg-surface-2 text-fg-muted hover:text-fg-secondary"
  }`;
}

function ItemRow({ item, overdue }: { item: AgendaItem; overdue: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ChaseResult | null>(null);

  function onChase() {
    startTransition(async () => {
      const res = await chaseAgendaItem({
        title: item.title,
        kind: item.kind,
        href: item.href,
      });
      setResult(res);
    });
  }

  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border p-4 ${
        overdue
          ? "border-status-danger/30 bg-status-danger/10"
          : "border-line bg-surface-1"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${dotClass(item, overdue)}`}
          aria-hidden
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Link
            href={item.href}
            className="truncate text-sm font-medium text-fg-primary transition hover:text-gold-300"
          >
            {item.title}
          </Link>
          <span className="shrink-0 rounded-full border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
            {KIND_LABEL[item.kind]}
          </span>
          {item.meta ? (
            <span className="truncate text-xs text-fg-muted">{item.meta}</span>
          ) : null}
        </div>
        <span
          className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${
            overdue ? "text-status-danger" : "text-fg-muted"
          }`}
        >
          {relativeDue(item.when)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3 pl-5">
        <button
          type="button"
          onClick={onChase}
          disabled={pending}
          className="rounded-full border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-gold-300 transition hover:text-gold-400 disabled:opacity-50"
        >
          {pending ? "Routing…" : "Have Earn chase this"}
        </button>
        {result?.ok && result.sessionId ? (
          <span className="text-xs text-fg-muted">
            {result.planTitle ? (
              <span className="text-fg-secondary">{result.planTitle} · </span>
            ) : null}
            <Link
              href={`/session/${result.sessionId}`}
              className="text-gold-300 transition hover:text-gold-400"
            >
              Open session →
            </Link>
          </span>
        ) : null}
        {result && !result.ok ? (
          <span className="text-xs text-status-danger">{result.error}</span>
        ) : null}
      </div>
    </div>
  );
}

export function AgendaControls({ items }: { items: AgendaItem[] }) {
  const [kinds, setKinds] = useState<Set<AgendaKind>>(new Set());
  const [severities, setSeverities] = useState<Set<RiskSeverity>>(new Set());
  const [overdueOnly, setOverdueOnly] = useState(false);

  function toggleKind(k: AgendaKind) {
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function toggleSeverity(s: RiskSeverity) {
    setSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  const buckets = useMemo(() => {
    const filtered = items.filter((item) => {
      if (kinds.size > 0 && !kinds.has(item.kind)) return false;
      if (severities.size > 0) {
        if (!item.severity || !severities.has(item.severity)) return false;
      }
      return true;
    });
    const grouped = groupAgenda(filtered);
    return overdueOnly ? grouped.filter((b) => b.key === "overdue") : grouped;
  }, [items, kinds, severities, overdueOnly]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-1 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Kind
          </span>
          {KIND_ORDER.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => toggleKind(k)}
              className={chipClass(kinds.has(k))}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Severity
          </span>
          {SEVERITY_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggleSeverity(s)}
              className={chipClass(severities.has(s))}
            >
              {SEVERITY_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Filter
          </span>
          <button
            type="button"
            onClick={() => setOverdueOnly((v) => !v)}
            className={chipClass(overdueOnly)}
          >
            Overdue only
          </button>
        </div>
      </div>

      {buckets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
          Nothing scheduled — you&rsquo;re clear.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {buckets.map((bucket) => {
            const overdue = bucket.key === "overdue";
            return (
              <section key={bucket.key}>
                <h2 className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
                  <span className={overdue ? "text-status-danger" : undefined}>
                    {bucket.label}
                  </span>
                  <span className="rounded-full border border-line bg-surface-2 px-1.5 py-0.5 text-[9px] tracking-wider text-fg-muted">
                    {bucket.items.length}
                  </span>
                </h2>
                <div className="flex flex-col gap-2">
                  {bucket.items.map((item) => (
                    <ItemRow key={item.id} item={item} overdue={overdue} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
