'use client';

import { useState, useTransition } from 'react';
import {
  Users,
  Building2,
  CircleDollarSign,
  Search,
  Handshake,
  Sparkles,
  CheckCircle2,
  Clock,
  SendHorizonal,
  UserCog,
  X
} from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Input,
  Select,
  SegTabs,
  SectionTitle,
  type BadgeTone,
  type TabItem
} from '@/components/ui';
import { EmptyState } from '@/components/shell/EmptyState';
import { ProviderDiscovery } from '@/components/partners/ProviderDiscovery';
import { requestPartnerIntro } from '@/lib/actions/partners';
import type {
  PartnersData,
  ServiceProvider,
  CapitalProvider,
  IntroStatusMap
} from '@/lib/queries/partners';

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

/**
 * Tone rail metadata for a partner card — mirrors the scoreMeta pattern in
 * MatchInboxView so directory cards scan the same way as match cards.
 */
function partnerMeta(type: 'service' | 'capital'): { accent: string; tone: BadgeTone } {
  if (type === 'capital') return { accent: 'var(--gold-1)', tone: 'gold' };
  return { accent: 'var(--azure-1)', tone: 'azure' };
}

const TYPE_TABS: TabItem[] = [
  { id: 'all', label: 'All' },
  { id: 'service', label: 'Service' },
  { id: 'capital', label: 'Capital' }
];

const ALL_VALUE = '__all__';

/* ---- Apply button -------------------------------------------------------- */

interface ApplyButtonProps {
  partnerId: string;
  partnerName: string;
  partnerType: 'service_provider' | 'capital_provider';
  initialStatus: string | undefined;
}

function ApplyButton({ partnerId, partnerName, partnerType, initialStatus }: ApplyButtonProps) {
  const [status, setStatus] = useState<string | undefined>(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (status === 'requested') {
    return (
      <div className="flex items-center gap-1.5 text-[12px] text-fg-4">
        <Clock size={13} strokeWidth={1.9} aria-hidden />
        <span>Request sent</span>
      </div>
    );
  }

  if (status === 'accepted' || status === 'introduced') {
    return (
      <div className="flex items-center gap-1.5 text-[12px] text-success">
        <CheckCircle2 size={13} strokeWidth={1.9} aria-hidden />
        <span>Intro accepted</span>
      </div>
    );
  }

  function handleApply() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await requestPartnerIntro({
          partnerId,
          partnerName,
          partnerType,
          rationale: undefined
        });
        if (result.ok) {
          setStatus(result.status);
        } else {
          setError(result.error);
        }
      } catch {
        setError('Could not submit request.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        size="sm"
        variant="primary"
        icon={SendHorizonal}
        disabled={pending}
        onClick={handleApply}
      >
        {pending ? 'Requesting…' : 'Request intro'}
      </Button>
      {error ? (
        <p className="flex items-center gap-1 text-[11px] text-danger">
          <X size={11} strokeWidth={2} aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ---- Service provider card --------------------------------------------- */

function ServiceCard({
  provider,
  introStatus
}: {
  provider: ServiceProvider;
  introStatus: IntroStatusMap;
}) {
  const meta = (provider.capabilities._meta ?? null) as {
    description?: string | null;
    assignedSpecialist?: string | null;
  } | null;
  const caps = Object.keys(provider.capabilities).filter((k) => !k.startsWith('_'));
  const { accent } = partnerMeta('service');

  return (
    <Card className="relative flex flex-col gap-3 overflow-hidden p-4">
      {/* Tone accent rail */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: accent }}
      />
      <div className="flex items-start gap-3 pl-3">
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

      {meta?.description ? (
        <p className="pl-3 text-[12px] leading-5 text-fg-3">{meta.description}</p>
      ) : null}

      {caps.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-t border-hairline pl-3 pt-3">
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

      <div className="flex items-end justify-between gap-2 border-t border-hairline pl-3 pt-3">
        <ApplyButton
          partnerId={provider.id}
          partnerName={provider.name}
          partnerType="service_provider"
          initialStatus={introStatus[provider.id]}
        />
        {meta?.assignedSpecialist ? (
          <span className="inline-flex items-center gap-1 text-[10.5px] text-fg-5">
            <UserCog size={11} strokeWidth={1.9} className="text-azure-1" aria-hidden />
            {meta.assignedSpecialist}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

/* ---- Capital provider card --------------------------------------------- */

function CapitalCard({
  provider,
  introStatus
}: {
  provider: CapitalProvider;
  introStatus: IntroStatusMap;
}) {
  const hasCheck = provider.checkSizeMin != null || provider.checkSizeMax != null;
  const meta = provider.criteria as {
    description?: string | null;
    assignedSpecialist?: string | null;
  };
  const { accent } = partnerMeta('capital');

  return (
    <Card className="relative flex flex-col gap-3 overflow-hidden p-4">
      {/* Tone accent rail */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: accent }}
      />
      <div className="flex items-start gap-3 pl-3">
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

      {meta?.description ? (
        <p className="pl-3 text-[12px] leading-5 text-fg-3">{meta.description}</p>
      ) : null}

      {hasCheck ? (
        <div className="flex items-center gap-1.5 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2.5 py-1.5 pl-5 text-[12px] text-gold-1">
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
        <div className="flex flex-wrap gap-1.5 border-t border-hairline pl-3 pt-3">
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

      <div className="flex items-end justify-between gap-2 border-t border-hairline pl-3 pt-3">
        <ApplyButton
          partnerId={provider.id}
          partnerName={provider.name}
          partnerType="capital_provider"
          initialStatus={introStatus[provider.id]}
        />
        {meta?.assignedSpecialist ? (
          <span className="inline-flex items-center gap-1 text-[10.5px] text-fg-5">
            <UserCog size={11} strokeWidth={1.9} className="text-gold-1" aria-hidden />
            {meta.assignedSpecialist}
          </span>
        ) : null}
      </div>
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
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_VALUE);
  const [capitalTypeFilter, setCapitalTypeFilter] = useState<string>(ALL_VALUE);
  const [query, setQuery] = useState('');
  const [discoverOpen, setDiscoverOpen] = useState(false);

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
            title="Build your partner bench"
            body="Find service providers (legal, compliance, fund admin) and capital providers (LPs, family offices, fund-of-funds) with AI, then bring the best matches into your ops in one click."
            action={
              <Button variant="primary" icon={Sparkles} onClick={() => setDiscoverOpen(true)}>
                Discover with AI
              </Button>
            }
          />
        </Card>
        <ProviderDiscovery open={discoverOpen} onClose={() => setDiscoverOpen(false)} />
      </div>
    );
  }

  // Plain derived state — no useMemo per repo lint rules.
  const showSP = typeFilter === 'all' || typeFilter === 'service';
  const showCP = typeFilter === 'all' || typeFilter === 'capital';
  const q = query.trim().toLowerCase();

  const filteredSP = showSP
    ? data.serviceProviders.filter((p) => {
        if (categoryFilter !== ALL_VALUE && p.category !== categoryFilter) return false;
        if (
          q &&
          !p.name.toLowerCase().includes(q) &&
          !(p.category?.toLowerCase().includes(q) ?? false)
        )
          return false;
        return true;
      })
    : [];

  const filteredCP = showCP
    ? data.capitalProviders.filter((p) => {
        if (capitalTypeFilter !== ALL_VALUE && !p.capitalTypes.includes(capitalTypeFilter))
          return false;
        if (
          q &&
          !p.name.toLowerCase().includes(q) &&
          !p.capitalTypes.some((t) => t.toLowerCase().includes(q))
        )
          return false;
        return true;
      })
    : [];

  const totalVisible = filteredSP.length + filteredCP.length;

  // Build dropdown options from facets — only shown when the relevant type tab is active.
  const categoryOptions = data.facets.categories.map((c) => ({
    value: c,
    label: humanize(c)
  }));
  const capitalTypeOptions = data.facets.capitalTypes.map((t) => ({
    value: t,
    label: humanize(t)
  }));

  return (
    <div className="space-y-6">
      <PartnersHeader
        serviceCount={data.serviceProviders.length}
        capitalCount={data.capitalProviders.length}
      />

      {/* Filter rail */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SegTabs tabs={TYPE_TABS} active={typeFilter} onChange={setTypeFilter} />
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="w-full sm:w-64">
              <Input
                icon={Search}
                placeholder="Search partners…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Button
              variant="primary"
              icon={Sparkles}
              className="flex-none"
              onClick={() => setDiscoverOpen(true)}
            >
              <span className="hidden sm:inline">Discover with AI</span>
              <span className="sm:hidden">Discover</span>
            </Button>
          </div>
        </div>

        {/* Secondary facet filters */}
        {(showSP && categoryOptions.length > 0) || (showCP && capitalTypeOptions.length > 0) ? (
          <div className="flex flex-wrap gap-3">
            {showSP && categoryOptions.length > 0 ? (
              <div className="w-52">
                <Select
                  options={[{ value: ALL_VALUE, label: 'All categories' }, ...categoryOptions]}
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  aria-label="Filter by category"
                />
              </div>
            ) : null}
            {showCP && capitalTypeOptions.length > 0 ? (
              <div className="w-52">
                <Select
                  options={[
                    { value: ALL_VALUE, label: 'All capital types' },
                    ...capitalTypeOptions
                  ]}
                  value={capitalTypeFilter}
                  onChange={(e) => setCapitalTypeFilter(e.target.value)}
                  aria-label="Filter by capital type"
                />
              </div>
            ) : null}
          </div>
        ) : null}
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
          {filteredSP.length > 0 ? (
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
                  <ServiceCard key={p.id} provider={p} introStatus={data.introStatus} />
                ))}
              </div>
            </section>
          ) : null}

          {/* Capital providers */}
          {filteredCP.length > 0 ? (
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
                  <CapitalCard key={p.id} provider={p} introStatus={data.introStatus} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      <p className="text-center text-[11.5px] text-fg-5">
        {totalVisible} partner{totalVisible !== 1 ? 's' : ''} shown
      </p>

      <ProviderDiscovery open={discoverOpen} onClose={() => setDiscoverOpen(false)} />
    </div>
  );
}
