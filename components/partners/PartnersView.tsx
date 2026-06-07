'use client';

import { useMemo, useState } from 'react';
import { Users, Building2, CircleDollarSign, Search, Handshake, Sparkles } from 'lucide-react';
import {
  Avatar,
  Badge,
  Card,
  Input,
  SegTabs,
  SectionTitle,
  type BadgeTone,
  type TabItem
} from '@/components/ui';
import { EmptyState } from '@/components/shell/EmptyState';
import type { PartnersData, ServiceProvider, CapitalProvider } from '@/lib/queries/partners';

/* ---- Helpers ------------------------------------------------------------ */

function money(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

function humanize(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusTone(status: string): BadgeTone {
  const s = status.toLowerCase();
  if (s === 'active') return 'success';
  if (s === 'inactive' || s === 'churned') return 'danger';
  if (s === 'prospect' || s === 'pending') return 'warning';
  return 'neutral';
}

const FILTER_TABS: TabItem[] = [
  { id: 'all', label: 'All' },
  { id: 'service', label: 'Service Providers' },
  { id: 'capital', label: 'Capital Providers' }
];

/* ---- Service provider card --------------------------------------------- */

function ServiceCard({ provider }: { provider: ServiceProvider }) {
  const caps = Object.keys(provider.capabilities);

  return (
    <Card clickable className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <Avatar name={provider.name} size={38} tone="azure" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold text-fg-1">{provider.name}</h3>
            <Badge tone={statusTone(provider.status)} dot className="text-[10px]">
              {humanize(provider.status)}
            </Badge>
          </div>
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-[12px] text-fg-4">
            <Building2 size={12} strokeWidth={1.9} className="text-azure-1" aria-hidden />
            {provider.category ? humanize(provider.category) : 'Service provider'}
          </p>
        </div>
      </div>

      {caps.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-t border-hairline pt-3">
          {caps.slice(0, 5).map((cap) => (
            <span
              key={cap}
              className="rounded-lg border border-hairline bg-bg-1 px-2 py-0.5 text-[11px] text-fg-3"
            >
              {humanize(cap)}
            </span>
          ))}
          {caps.length > 5 ? (
            <span className="rounded-lg border border-hairline bg-bg-1 px-2 py-0.5 text-[11px] text-fg-4">
              +{caps.length - 5} more
            </span>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/* ---- Capital provider card --------------------------------------------- */

function CapitalCard({ provider }: { provider: CapitalProvider }) {
  const hasCheck = provider.checkSizeMin != null || provider.checkSizeMax != null;

  return (
    <Card clickable className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <Avatar name={provider.name} size={38} tone="gold" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold text-fg-1">{provider.name}</h3>
            <Badge tone={statusTone(provider.status)} dot className="text-[10px]">
              {humanize(provider.status)}
            </Badge>
          </div>
          {provider.capitalTypes.length > 0 ? (
            <p className="mt-0.5 text-[12px] text-fg-4">
              {provider.capitalTypes.map(humanize).join(' · ')}
            </p>
          ) : (
            <p className="mt-0.5 text-[12px] text-fg-4">Capital provider</p>
          )}
        </div>
      </div>

      {hasCheck ? (
        <div className="flex items-center gap-1.5 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2.5 py-1.5 text-[12px] text-gold-1">
          <CircleDollarSign size={13} strokeWidth={2} aria-hidden />
          <span className="font-semibold tabular-nums">
            {provider.checkSizeMin != null ? money(provider.checkSizeMin) : '—'}
            {' – '}
            {provider.checkSizeMax != null ? money(provider.checkSizeMax) : '—'}
          </span>
          <span className="text-fg-4">check size</span>
        </div>
      ) : null}

      {provider.capitalTypes.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-t border-hairline pt-3">
          {provider.capitalTypes.map((t) => (
            <span
              key={t}
              className="rounded-lg border border-hairline bg-bg-1 px-2 py-0.5 text-[11px] text-fg-3"
            >
              {humanize(t)}
            </span>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/* ---- Header / stat band ------------------------------------------------- */

function PartnersHeader({
  serviceCount,
  capitalCount
}: {
  serviceCount: number;
  capitalCount: number;
}) {
  const stats: { label: string; value: number; tone: BadgeTone }[] = [
    { label: 'Service providers', value: serviceCount, tone: 'azure' },
    { label: 'Capital providers', value: capitalCount, tone: 'gold' },
    { label: 'Total partners', value: serviceCount + capitalCount, tone: 'neutral' }
  ];

  return (
    <Card className="relative overflow-hidden p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(70% 130% at 0% 0%, rgba(91,141,239,0.08), transparent 60%), radial-gradient(60% 100% at 100% 0%, rgba(247,201,72,0.06), transparent 65%)'
        }}
      />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3.5">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl border border-hairline bg-bg-1 text-azure-1 shadow-[var(--shadow-sm)]">
            <Handshake size={19} strokeWidth={1.9} aria-hidden />
          </span>
          <div>
            <p className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-azure-1">
              <Sparkles size={11} strokeWidth={2} aria-hidden />
              Intelligence · Partner Directory
            </p>
            <h1 className="mt-1 text-[20px] font-semibold tracking-[-0.015em] text-fg-1">
              Partner Marketplace
            </h1>
            <p className="mt-0.5 max-w-[56ch] text-[12.5px] text-fg-4">
              Your service providers and capital providers — the relationships that move closes
              forward, in one private directory.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end">
          {stats.map((s) => (
            <div
              key={s.label}
              className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-bg-1 px-3 py-1.5"
            >
              <span className="text-[10.5px] uppercase tracking-[0.08em] text-fg-5">{s.label}</span>
              <Badge tone={s.tone} className="tabular-nums text-[11px]">
                {s.value}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ---- Main view ---------------------------------------------------------- */

export interface PartnersViewProps {
  data: PartnersData;
}

export function PartnersView({ data }: PartnersViewProps) {
  const [filter, setFilter] = useState<string>('all');
  const [query, setQuery] = useState('');

  const filteredSP = useMemo(() => {
    if (!query.trim()) return data.serviceProviders;
    const q = query.toLowerCase();
    return data.serviceProviders.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.category?.toLowerCase().includes(q) ?? false)
    );
  }, [data.serviceProviders, query]);

  const filteredCP = useMemo(() => {
    if (!query.trim()) return data.capitalProviders;
    const q = query.toLowerCase();
    return data.capitalProviders.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.capitalTypes.some((t) => t.toLowerCase().includes(q))
    );
  }, [data.capitalProviders, query]);

  const showSP = filter === 'all' || filter === 'service';
  const showCP = filter === 'all' || filter === 'capital';

  if (data.empty) {
    return (
      <div className="space-y-5">
        <PartnersHeader serviceCount={0} capitalCount={0} />
        <Card className="relative overflow-hidden p-2">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                'radial-gradient(60% 120% at 0% 0%, rgba(91,141,239,0.07), transparent 60%), radial-gradient(50% 100% at 100% 0%, rgba(247,201,72,0.05), transparent 65%)'
            }}
          />
          <EmptyState
            icon={Users}
            title="Your directory is ready"
            body="Service providers (legal, compliance, fund admin) and capital providers (LPs, family offices, fund-of-funds) appear here the moment they're added to your organization."
          />
        </Card>
      </div>
    );
  }

  const totalVisible = (showSP ? filteredSP.length : 0) + (showCP ? filteredCP.length : 0);

  return (
    <div className="space-y-6">
      <PartnersHeader
        serviceCount={data.serviceProviders.length}
        capitalCount={data.capitalProviders.length}
      />

      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegTabs tabs={FILTER_TABS} active={filter} onChange={setFilter} />
        <div className="w-full sm:w-64">
          <Input
            icon={Search}
            placeholder="Search partners…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {totalVisible === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching partners"
          body="Try adjusting the filter or search query."
        />
      ) : (
        <>
          {/* Service providers */}
          {showSP && filteredSP.length > 0 ? (
            <section aria-label="Service providers">
              <SectionTitle
                eyebrow="Execution partners"
                title="Service Providers"
                action={
                  <Badge tone="azure" className="text-[10.5px]">
                    {filteredSP.length}
                  </Badge>
                }
              />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredSP.map((p) => (
                  <ServiceCard key={p.id} provider={p} />
                ))}
              </div>
            </section>
          ) : null}

          {/* Capital providers */}
          {showCP && filteredCP.length > 0 ? (
            <section aria-label="Capital providers">
              <SectionTitle
                eyebrow="Capital relationships"
                title="Capital Providers"
                action={
                  <Badge tone="gold" className="text-[10.5px]">
                    {filteredCP.length}
                  </Badge>
                }
              />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredCP.map((p) => (
                  <CapitalCard key={p.id} provider={p} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      <p className="text-center text-[11.5px] text-fg-5">
        {totalVisible} partner{totalVisible !== 1 ? 's' : ''} shown
      </p>
    </div>
  );
}
