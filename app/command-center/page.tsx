import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Flame, Handshake, LogOut, Radar, Sparkles, ThermometerSun } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getCommandCenterData, type CommandCenterData } from '@/lib/queries/command-center';
import { mandateCfg, type InvestorGroup } from '@/lib/onboarding/mandate';
import { TEAM_ROSTER } from '@/lib/team';
import { Badge } from '@/components/ui/Badge';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { signOutAction } from './actions';

export const metadata: Metadata = { title: 'Command Center' };

interface MandateRow {
  principal: string | null;
  firm: string | null;
  investor_group: string;
  investor_role: string | null;
  objective: string | null;
  vehicle: string | null;
  size: string | null;
  sectors: string[];
  stage: string | null;
  geo: string | null;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function money(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${amount}`;
}

/** The highest-impact next move, derived from what the desk can see today. */
function rightNow(data: CommandCenterData, mandate: MandateRow | null): string {
  if (data.activeDealsCount === 0)
    return 'Your pipeline is empty — Marcus is standing by. Add your first deal or connection and the desk starts scoring it against the mandate.';
  if (data.hotRelationshipsCount === 0)
    return `You have ${data.activeDealsCount} active deal${data.activeDealsCount === 1 ? '' : 's'} but no hot relationships — warming your top connections is the highest-leverage move this week.`;
  if (mandate?.objective === 'raise' || mandate?.objective === 'launch')
    return `${data.hotRelationshipsCount} hot relationship${data.hotRelationshipsCount === 1 ? '' : 's'} and ${money(data.capitalInMotion)} in motion — keep the raise conversations moving while momentum is real.`;
  return `${data.activeDealsCount} active deal${data.activeDealsCount === 1 ? '' : 's'}, ${money(data.capitalInMotion)} in motion — review what changed and approve the next step.`;
}

/**
 * Command Center — the reactive home the activation lands on. Greets the
 * operator, mirrors the mandate brief, and reads real desk state (deals,
 * capital in motion, relationship warmth) through RLS-scoped queries. The
 * lifecycle hubs (Build / Source / Run / Execute) arrive in follow-up passes.
 */
export default async function CommandCenterPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const supabase = await createClient();
  const [{ data: mandateRaw }, data, { data: orgRow }] = await Promise.all([
    supabase
      .from('mandates')
      .select(
        'principal, firm, investor_group, investor_role, objective, vehicle, size, sectors, stage, geo'
      )
      .eq('org_id', org.orgId)
      .maybeSingle(),
    getCommandCenterData(org.orgId),
    supabase.from('organizations').select('name').eq('id', org.orgId).maybeSingle()
  ]);

  const mandate = mandateRaw as MandateRow | null;
  const firmName = mandate?.firm ?? orgRow?.name ?? 'Your desk';
  const firstName = (mandate?.principal ?? '').trim().split(/\s+/)[0] || 'there';

  const cfg = mandateCfg((mandate?.investor_group as InvestorGroup) ?? 'fund');
  const objLabel = cfg.objectives.find((o) => o.id === mandate?.objective)?.label;
  const vehLabel = cfg.vehicles.find((v) => v.id === mandate?.vehicle)?.label;
  const sizeLabel = cfg.sizes.find((s) => s.id === mandate?.size)?.label;

  const kpis = [
    { icon: Radar, label: 'Active deals', value: String(data.activeDealsCount) },
    { icon: Handshake, label: 'Capital in motion', value: money(data.capitalInMotion) },
    { icon: Flame, label: 'Hot relationships', value: String(data.hotRelationshipsCount) },
    {
      icon: ThermometerSun,
      label: 'Warmed this week',
      value: String(data.warmRelationshipsThisWeek)
    }
  ];

  return (
    <main className="min-h-dvh bg-bg-0 text-fg-1">
      {/* topbar */}
      <header className="sticky top-0 z-20 border-b border-hairline bg-[var(--topbar-bg)] backdrop-blur">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between px-[clamp(16px,4vw,28px)] py-3.5">
          <div className="flex items-center gap-2.5">
            <EarnCoin size={26} />
            <span className="text-[14.5px] font-semibold tracking-[-0.02em]">
              FundExecs <span className="font-medium text-fg-4">OS</span>
            </span>
            <span className="mx-1 text-fg-5" aria-hidden>
              /
            </span>
            <span className="truncate text-[13px] text-fg-3">{firmName}</span>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-surface-1 px-3 py-1.5 text-[12.5px] text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
            >
              <LogOut size={13} aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="fx-rise mx-auto max-w-[1080px] px-[clamp(16px,4vw,28px)] py-8">
        {/* greeting */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Badge tone="gold" dot pulse className="mb-3">
              Desk live · 15 specialists on point
            </Badge>
            <h1 className="text-[clamp(24px,3.5vw,32px)] font-semibold tracking-[-0.02em]">
              {greeting()}, {firstName}.
            </h1>
            <p className="mt-1.5 text-[13.5px] text-fg-3">
              {mandate?.investor_role ?? 'Operator'}
              {objLabel ? ` · ${objLabel}` : ''}
              {sizeLabel ? ` · ${sizeLabel}` : ''}
              {vehLabel ? ` ${vehLabel}` : ''}
            </p>
          </div>
        </div>

        {/* the one move */}
        <section className="mt-6 rounded-2xl border border-[var(--gold-line)] bg-[var(--gold-soft)] p-5">
          <div className="flex items-start gap-3.5">
            <EarnCoin size={36} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-gold-1">
                <Sparkles size={12} aria-hidden />
                Right now
              </div>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-fg-1">
                {rightNow(data, mandate)}
              </p>
            </div>
          </div>
        </section>

        {/* KPIs */}
        <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map(({ icon: Icon, label, value }) => (
            <div key={label} className="rounded-2xl border border-hairline bg-surface-1 px-4 py-4">
              <Icon size={17} strokeWidth={1.9} className="text-azure-1" aria-hidden />
              <div className="mt-2.5 text-[26px] font-semibold tracking-[-0.02em] [font-feature-settings:'tnum']">
                {value}
              </div>
              <div className="mt-0.5 text-[12px] text-fg-4">{label}</div>
            </div>
          ))}
        </section>

        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-5">
          {/* recent deals */}
          <section className="rounded-2xl border border-hairline bg-bg-1 p-5 lg:col-span-3">
            <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Deal flow
            </h2>
            {data.recentDeals.length === 0 ? (
              <p className="mt-4 text-[13px] leading-relaxed text-fg-4">
                Nothing on the desk yet. As deals land, Marcus scores each one against your mandate
                and the strongest surface here first.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-[var(--border-faint)]">
                {data.recentDeals.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-medium text-fg-1">{d.name}</div>
                      <div className="mt-0.5 text-[11.5px] capitalize text-fg-5">
                        {d.status?.replace(/_/g, ' ')}
                      </div>
                    </div>
                    <span className="flex-none text-[13px] font-semibold [font-feature-settings:'tnum']">
                      {d.amount ? money(d.amount) : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* warm connections */}
          <section className="rounded-2xl border border-hairline bg-bg-1 p-5 lg:col-span-2">
            <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Warmest connections
            </h2>
            {data.topWarmConnections.length === 0 ? (
              <p className="mt-4 text-[13px] leading-relaxed text-fg-4">
                No relationships tracked yet. Sloane builds the LP target list from your mandate;
                connections warm as the desk works them.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-[var(--border-faint)]">
                {data.topWarmConnections.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-medium text-fg-1">{c.name}</div>
                      {c.company && (
                        <div className="mt-0.5 truncate text-[11.5px] text-fg-5">{c.company}</div>
                      )}
                    </div>
                    <Badge tone={c.status === 'hot' ? 'gold' : 'azure'}>{c.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* the team */}
        <section className="mt-6 rounded-2xl border border-hairline bg-bg-1 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Your executive team
            </h2>
            <span className="text-[11.5px] text-fg-5">
              {TEAM_ROSTER.length} specialists · led by Earn
            </span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {TEAM_ROSTER.map((m) => {
              const Icon = m.icon;
              return (
                <div key={m.slug} className="flex items-center gap-3">
                  {m.chief ? (
                    <EarnCoin size={32} />
                  ) : (
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[10px] border border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1">
                      <Icon size={15} strokeWidth={1.9} aria-hidden />
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-fg-1">{m.name}</div>
                    <div className="truncate text-[11.5px] text-fg-5">{m.position}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <p className="mt-8 text-center text-[11.5px] text-fg-5">
          The Build · Source · Run · Execute hubs come online next — everything the team does routes
          through your approval.
        </p>
      </div>
    </main>
  );
}
