'use client';

import { useMemo, useState } from 'react';
import { Users, Building2, CircleDollarSign, Search, ExternalLink } from 'lucide-react';
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
import { cn } from '@/lib/utils';
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
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <Avatar name={provider.name} size={36} tone="azure" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold text-fg-1">{provider.name}</h3>
            <Badge tone={statusTone(provider.status)} className="text-[10px]">
              {humanize(provider.status)}
            </Badge>
          </div>
          {provider.category ? (
            <p className="mt-0.5 text-[12px] text-fg-4">{humanize(provider.category)}</p>
          ) : null}
        </div>
      </div>

      {caps.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {caps.slice(0, 5).map((cap) => (
            <span
              key={cap}
              className="rounded-lg border border-hairline bg-surface-1 px-2 py-0.5 text-[11px] text-fg-3"
            >
              {humanize(cap)}
            </span>
          ))}
          {caps.length > 5 ? (
            <span className="rounded-lg border border-hairline bg-surface-1 px-2 py-0.5 text-[11px] text-fg-4">
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
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <Avatar name={provider.name} size={36} tone="gold" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold text-fg-1">{provider.name}</h3>
            <Badge tone={statusTone(provider.status)} className="text-[10px]">
              {humanize(provider.status)}
            </Badge>
          </div>
          {provider.capitalTypes.length > 0 ? (
            <p className="mt-0.5 text-[12px] text-fg-4">
              {provider.capitalTypes.map(humanize).join(' · ')}
            </p>
          ) : null}
        </div>
      </div>

      {provider.checkSizeMin != null || provider.checkSizeMax != null ? (
        <div className="flex items-center gap-1.5 text-[12px] text-fg-3">
          <CircleDollarSign size={13} strokeWidth={1.9} className="text-gold-1" aria-hidden />
          <span>
            {provider.checkSizeMin != null ? money(provider.checkSizeMin) : '—'}
            {' – '}
            {provider.checkSizeMax != null ? money(provider.checkSizeMax) : '—'}
          </span>
          <span className="text-fg-5">check size</span>
        </div>
      ) : null}

      {provider.capitalTypes.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {provider.capitalTypes.map((t) => (
            <span
              key={t}
              className="rounded-lg border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2 py-0.5 text-[11px] text-gold-1"
            >
              {humanize(t)}
            </span>
          ))}
        </div>
      ) : null}
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
    let list = data.serviceProviders;
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.category?.toLowerCase().includes(q) ?? false)
      );
    }
    return list;
  }, [data.serviceProviders, query]);

  const filteredCP = useMemo(() => {
    let list = data.capitalProviders;
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.capitalTypes.some((t) => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [data.capitalProviders, query]);

  const showSP = filter === 'all' || filter === 'service';
  const showCP = filter === 'all' || filter === 'capital';

  if (data.empty) {
    return (
      <EmptyState
        icon={Users}
        title="No partners yet"
        body="Service providers (legal, compliance, admin) and capital providers (LPs, family offices) will appear here once added to your organization."
      />
    );
  }

  const totalVisible = (showSP ? filteredSP.length : 0) + (showCP ? filteredCP.length : 0);

  return (
    <div className="space-y-6">
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
                eyebrow="Partner Directory"
                title="Service Providers"
                action={
                  <Badge tone="neutral" className="text-[10.5px]">
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
                eyebrow="Partner Directory"
                title="Capital Providers"
                action={
                  <Badge tone="neutral" className="text-[10.5px]">
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
