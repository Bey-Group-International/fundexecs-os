'use client';

import { createElement, useEffect, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  AtSign,
  Building2,
  Calendar,
  CalendarClock,
  Check,
  Globe,
  Hand,
  Hash,
  IdCard,
  Link2,
  Loader2,
  Mail,
  Megaphone,
  MessageSquare,
  Palette,
  PenLine,
  Plug,
  Plus,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  UserCheck,
  Users,
  type LucideIcon
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { SegTabs } from '@/components/ui/Tabs';
import { publishBrandAsset, setPresenceItem } from '@/lib/brand-studio/actions';
import {
  BRAND_BUILD,
  BRAND_ITEM_NAME,
  CONNECTORS,
  PRESENCE_ITEMS,
  brandDefaults,
  brandRows,
  buildSteps,
  paletteFor,
  type BrandBuildCfg,
  type BrandValue
} from '@/lib/brand-studio/config';
import {
  isBrandAssetId,
  type BrandAssetId,
  type BrandStudioDoc
} from '@/lib/brand-studio/persistence';
import { cn } from '@/lib/utils';

/* ── icon resolvers ──────────────────────────────────────────────────────── */
const ICONS: Record<string, LucideIcon> = {
  linkedin: Users,
  twitter: MessageSquare,
  mail: Mail,
  calendar: Calendar,
  'calendar-clock': CalendarClock,
  slack: Hash,
  'at-sign': AtSign,
  'building-2': Building2,
  'pen-line': PenLine
};
function icon(name: string): LucideIcon {
  return ICONS[name] ?? Link2;
}

/** Brand connectors backed by the real integrations layer (OAuth routes). */
const CONNECTOR_PROVIDER: Record<string, string> = {
  gmail: 'gmail',
  calendar: 'google_calendar',
  calendly: 'calendly',
  slack: 'slack'
};

function Chip({
  label,
  selected,
  onClick
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition',
        selected
          ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-fg-1'
          : 'border-hairline bg-surface-1 text-fg-3 hover:bg-surface-2'
      )}
    >
      {selected && <Check size={12} strokeWidth={2.4} aria-hidden />}
      {label}
    </button>
  );
}

function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4', className)}
    >
      {children}
    </div>
  );
}

function PanelHeader({
  icon: Ico,
  title,
  eyebrow,
  action
}: {
  icon: LucideIcon;
  title: string;
  eyebrow: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
          <Ico size={16} strokeWidth={1.9} aria-hidden />
        </span>
        <div>
          <Eyebrow className="mb-px">{eyebrow}</Eyebrow>
          <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">{title}</div>
        </div>
      </div>
      {action}
    </div>
  );
}

/* ── the copiloted brand builder ─────────────────────────────────────────── */

function BrandBuilder({
  id,
  initialSpec,
  alreadyLive,
  onBack,
  onPublished
}: {
  id: BrandAssetId;
  /** Persisted spec when re-opening a published asset. */
  initialSpec: Record<string, BrandValue> | null;
  alreadyLive: boolean;
  onBack: () => void;
  onPublished: (id: BrandAssetId, spec: Record<string, BrandValue>) => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const cfg: BrandBuildCfg = BRAND_BUILD[id];
  const name = BRAND_ITEM_NAME[id] ?? id;
  const [d, setD] = useState<Record<string, BrandValue>>(() => initialSpec ?? brandDefaults(cfg));
  const [applied, setApplied] = useState(false);
  const [phase, setPhase] = useState<'edit' | 'building' | 'done'>(alreadyLive ? 'done' : 'edit');
  const [n, setN] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const steps = buildSteps(name);

  const set = (k: string, v: BrandValue) => setD((p) => ({ ...p, [k]: v }));
  const toggle = (k: string, v: string) =>
    setD((p) => {
      const cur = (p[k] as string[]) ?? [];
      return { ...p, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
    });

  useEffect(() => {
    if (phase !== 'building') return;
    if (reduced) {
      const t = setTimeout(() => setPhase('done'), 300);
      return () => clearTimeout(t);
    }
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= steps.length) {
        clearInterval(timer);
        setTimeout(() => setPhase('done'), 450);
      }
    }, 580);
    return () => clearInterval(timer);
  }, [phase, reduced, steps.length]);

  async function publish() {
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await publishBrandAsset(id, d);
      if (res.ok) onPublished(id, d);
      else setPublishError(res.error);
    } catch {
      setPublishError('Could not publish — check your connection and try again.');
    } finally {
      setPublishing(false);
    }
  }

  if (phase === 'done') {
    return (
      <div className="mx-auto flex w-full max-w-[560px] flex-col items-center py-5">
        <span className="mb-3.5 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--success-line)] bg-[var(--success-soft)] text-success">
          <Check size={28} strokeWidth={2.2} aria-hidden />
        </span>
        <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-fg-1">
          {name} — {alreadyLive ? 'live' : 'produced'}
        </h2>
        <p className="mt-1.5 text-center text-[13px] text-fg-3">
          {alreadyLive
            ? 'Published across your workspace. Adjust the spec and re-publish anytime.'
            : 'Produced to your spec — publish to make it live across your workspace.'}
        </p>
        <div className="mt-4 w-full overflow-hidden rounded-[14px] border border-hairline">
          {brandRows(cfg, d).map(([k, v], i) => (
            <div
              key={k}
              className={cn(
                'flex gap-3.5 px-[15px] py-2.5',
                i % 2 === 0 ? 'bg-surface-1' : 'bg-transparent',
                i > 0 && 'border-t border-[var(--border-faint)]'
              )}
            >
              <span className="w-[120px] flex-none text-[12px] text-fg-4">{k}</span>
              <span className="text-[13px] font-medium text-fg-1">{v}</span>
            </div>
          ))}
        </div>
        {publishError && (
          <div className="mt-3 flex w-full items-center gap-2.5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-danger">
            <TriangleAlert size={15} aria-hidden />
            {publishError}
          </div>
        )}
        <div className="mt-5 flex w-full flex-wrap items-center justify-between gap-2.5">
          <Button
            variant="ghost"
            icon={ArrowLeft}
            onClick={() => {
              setPhase('edit');
              setN(0);
            }}
          >
            Go back &amp; edit
          </Button>
          {alreadyLive ? (
            <Button variant="outline" iconRight={Check} onClick={onBack}>
              Close
            </Button>
          ) : (
            <Button
              variant="gold"
              icon={publishing ? Loader2 : undefined}
              iconRight={publishing ? undefined : Check}
              disabled={publishing}
              onClick={() => void publish()}
            >
              {publishing ? 'Publishing…' : 'Publish & finish'}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'building') {
    const pct = Math.round((n / steps.length) * 100);
    return (
      <div className="mx-auto flex w-full max-w-[540px] flex-col items-center py-6">
        <div className="mb-4 flex flex-col items-center text-center">
          <div className="relative mb-3">
            <span
              aria-hidden
              className="absolute -inset-2.5 rounded-full motion-safe:animate-pulse"
              style={{
                background: 'radial-gradient(circle, rgba(247,201,72,0.5), transparent 70%)',
                filter: 'blur(8px)'
              }}
            />
            <EarnCoin size={52} className="relative" />
          </div>
          <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">
            Producing {name}…
          </h2>
        </div>
        <ProgressBar value={pct} height={6} label="Production progress" className="w-full" />
        <Card className="mt-3.5 flex w-full flex-col gap-0.5 p-3">
          {steps.map((s, i) =>
            i <= n ? (
              <div key={s} className="flex items-center gap-2.5 px-2 py-2">
                <span
                  className={cn(
                    'flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border',
                    i < n
                      ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                      : 'border-hairline bg-surface-2 text-fg-4'
                  )}
                >
                  {i < n ? (
                    <Check size={12} strokeWidth={2.4} aria-hidden />
                  ) : (
                    <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden />
                  )}
                </span>
                <span className={cn('text-[13px]', i < n ? 'text-fg-2' : 'text-fg-1')}>{s}</span>
              </div>
            ) : null
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" icon={ArrowLeft} onClick={onBack}>
          Back
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[18px] font-semibold tracking-[-0.015em] text-fg-1">{name}</h1>
          <p className="text-[12px] text-fg-4">You set the direction, Earn produces it</p>
        </div>
        <Badge tone="azure" dot>
          Copiloted
        </Badge>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="p-5">
          <p className="mb-4 text-[12.5px] leading-relaxed text-fg-4">{cfg.intro}</p>
          <div className="flex flex-col gap-5">
            {cfg.decisions.map((dec) => (
              <div key={dec.key}>
                <Eyebrow className="mb-2.5">
                  {dec.label}
                  {dec.kind === 'multi' && (
                    <span className="font-normal normal-case tracking-normal text-fg-5">
                      {' '}
                      · pick any
                    </span>
                  )}
                </Eyebrow>
                <div className="flex flex-wrap gap-2">
                  {dec.opts.map((o) => (
                    <Chip
                      key={o}
                      label={o}
                      selected={
                        dec.kind === 'multi'
                          ? ((d[dec.key] as string[]) ?? []).includes(o)
                          : d[dec.key] === o
                      }
                      onClick={() => (dec.kind === 'multi' ? toggle(dec.key, o) : set(dec.key, o))}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2.5">
            <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
              Cancel
            </Button>
            <Button variant="gold" iconRight={Sparkles} onClick={() => setPhase('building')}>
              Produce &amp; publish
            </Button>
          </div>
        </Card>
        <Card className="self-start p-[17px]">
          <div className="mb-3 flex items-center gap-2.5">
            <EarnCoin size={32} online className="flex-none" />
            <div>
              <div className="text-[13px] font-semibold text-fg-1">Earn</div>
              <div className="text-[10.5px] text-fg-4">Brand copilot</div>
            </div>
          </div>
          <Eyebrow className="mb-1.5 text-gold-1">Earn recommends</Eyebrow>
          <div className="text-[12.5px] leading-relaxed text-fg-2">{cfg.recText}</div>
          <Button
            variant={applied ? 'secondary' : 'gold'}
            size="sm"
            icon={applied ? Check : Sparkles}
            className="mt-3.5 w-full"
            onClick={() => {
              setD(brandDefaults(cfg));
              setApplied(true);
            }}
          >
            {applied ? 'Recommendation applied' : "Apply Earn's recommendation"}
          </Button>
          <div className="mt-3 flex items-center gap-1.5 text-[11px] text-fg-5">
            <Hand size={12} aria-hidden />
            You&apos;re in control — change anything.
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ── brand stat ──────────────────────────────────────────────────────────── */

function BrandStat({
  label,
  value,
  sub,
  tone
}: {
  label: string;
  value: string;
  sub: string;
  tone: string;
}) {
  return (
    <Card className="p-3.5">
      <div className="text-[11px] text-fg-4">{label}</div>
      <div className="mt-1.5 text-[19px] font-semibold" style={{ color: tone }}>
        {value}
      </div>
      <div className="mt-0.5 text-[10.5px] text-fg-5">{sub}</div>
    </Card>
  );
}

/* ── the profile & brand studio ──────────────────────────────────────────── */

export interface BrandStudioFlowProps {
  firm: string;
  principal: string;
  /** Persisted document from `getBrandStudioDoc`. */
  initialDoc: BrandStudioDoc;
  /** Real integration statuses (provider id → connected) for the connectors. */
  connections: Record<string, boolean>;
}

export function BrandStudioFlow({
  firm,
  principal,
  initialDoc,
  connections
}: BrandStudioFlowProps) {
  const [view, setView] = useState<'profile' | 'brand' | 'presence'>('profile');
  const [openId, setOpenId] = useState<BrandAssetId | null>(null);
  const [built, setBuilt] = useState(initialDoc.built);
  const [presence, setPresence] = useState<string[]>(initialDoc.presence);
  const [setupPending, setSetupPending] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  function setUp(id: string) {
    setSetupPending(id);
    setSetupError(null);
    setPresenceItem(id)
      .then((res) => {
        if (res.ok) setPresence((p) => (p.includes(id) ? p : [...p, id]));
        else setSetupError(res.error);
      })
      .catch(() => setSetupError('Could not save — try again.'))
      .finally(() => setSetupPending(null));
  }

  if (openId && isBrandAssetId(openId)) {
    return (
      <BrandBuilder
        key={openId}
        id={openId}
        initialSpec={built[openId] ?? null}
        alreadyLive={!!built[openId]}
        onBack={() => setOpenId(null)}
        onPublished={(id, spec) => {
          setBuilt((p) => ({ ...p, [id]: spec }));
          setOpenId(null);
        }}
      />
    );
  }

  const bioBuilt = !!built.bio;
  const kitBuilt = !!built.brandkit;
  const siteBuilt = !!built.website;
  const credentialsDone = presence.includes('credentials');
  const palette = paletteFor(built.brandkit?.palette as string | undefined);

  return (
    <div className="flex flex-col gap-4">
      {/* header */}
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <Megaphone size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">
              Your profile &amp; brand
            </h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              The public face of your raise — built from your fund story.
            </p>
          </div>
          <Badge tone="warning" className="ml-1 self-start text-[10px]">
            Illustrative
          </Badge>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <BrandStat
            label="Profile"
            value={bioBuilt ? 'Live' : 'Draft'}
            sub="GP bio & credentials"
            tone={bioBuilt ? 'var(--success)' : 'var(--gold-1)'}
          />
          <BrandStat
            label="Firm brand"
            value={kitBuilt ? 'Set' : 'Pending'}
            sub="identity & voice"
            tone={kitBuilt ? 'var(--success)' : 'var(--accent)'}
          />
          <BrandStat
            label="Web presence"
            value={siteBuilt ? 'Live' : 'Pending'}
            sub="site & domain"
            tone={siteBuilt ? 'var(--success)' : 'var(--info)'}
          />
        </div>
      </Card>

      <SegTabs
        active={view}
        onChange={(id) => setView(id as 'profile' | 'brand' | 'presence')}
        tabs={[
          { id: 'profile', label: 'Profile', icon: IdCard },
          { id: 'brand', label: 'Firm brand', icon: Palette },
          { id: 'presence', label: 'Digital presence', icon: Globe }
        ]}
      />

      {setupError && (
        <div className="flex items-center gap-2.5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-danger">
          <TriangleAlert size={15} aria-hidden />
          {setupError}
        </div>
      )}

      {view === 'profile' ? (
        <>
          <Card className="p-[18px]">
            <PanelHeader
              icon={IdCard}
              title="Your public profile"
              eyebrow="How LPs first see you"
            />
            <div className="flex flex-wrap items-start gap-4">
              <Avatar name={principal} size={64} tone="gold" />
              <div className="min-w-[200px] flex-1">
                <div className="text-[17px] font-semibold text-fg-1">{principal}</div>
                <div className="text-[12.5px] font-medium text-gold-1">
                  Managing Partner · {firm}
                </div>
                <div className="mt-2.5 max-w-[62ch] text-[12px] leading-relaxed text-fg-2">
                  {bioBuilt ? (
                    `${principal} is the Managing Partner of ${firm} — positioned as ${String(built.bio?.voice ?? 'an operator').toLowerCase()}-first, with ${(
                      (built.bio?.include as string[]) ?? []
                    )
                      .map((s) => s.toLowerCase())
                      .join(', ')} leading the story.`
                  ) : (
                    <span className="italic text-fg-5">
                      Your bio will appear here once Earn drafts it from your fund story.
                    </span>
                  )}
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-[18px]">
            <PanelHeader
              icon={UserCheck}
              title="Build your profile"
              eyebrow="Copiloted by Sienna"
            />
            <div className="flex flex-col gap-1.5">
              {[
                {
                  id: 'bio' as const,
                  name: 'Professional bio',
                  sub: 'Drafted from your fund story',
                  done: bioBuilt,
                  copilot: true
                },
                {
                  id: 'credentials' as const,
                  name: 'Credentials & track record',
                  sub: 'Structured & verified from your history',
                  done: credentialsDone,
                  copilot: false
                }
              ].map((it) => (
                <div
                  key={it.id}
                  className="flex items-center gap-2.5 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3"
                >
                  <span
                    className={cn(
                      'flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border',
                      it.done
                        ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                        : 'border-hairline bg-surface-2 text-fg-3'
                    )}
                  >
                    {it.done ? (
                      <Check size={15} aria-hidden />
                    ) : it.copilot ? (
                      <Sparkles size={15} aria-hidden />
                    ) : (
                      <TrendingUp size={15} aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-semibold text-fg-1">{it.name}</div>
                    <div className="text-[10.5px] text-fg-5">{it.sub}</div>
                  </div>
                  {it.done ? (
                    it.copilot ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Sparkles}
                        onClick={() => setOpenId(it.id as BrandAssetId)}
                      >
                        Refine
                      </Button>
                    ) : (
                      <Badge tone="success" className="text-[9.5px]">
                        Done
                      </Badge>
                    )
                  ) : it.copilot ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={Sparkles}
                      onClick={() => setOpenId(it.id as BrandAssetId)}
                    >
                      Draft
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={setupPending === it.id ? Loader2 : Plus}
                      disabled={setupPending === it.id}
                      onClick={() => setUp(it.id)}
                    >
                      {setupPending === it.id ? 'Saving…' : 'Build'}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : view === 'brand' ? (
        <Card className="p-[18px]">
          <PanelHeader
            icon={Palette}
            title="Firm brand"
            eyebrow="Your visual identity"
            action={
              <Button
                variant={kitBuilt ? 'ghost' : 'secondary'}
                size="sm"
                icon={Sparkles}
                onClick={() => setOpenId('brandkit')}
              >
                {kitBuilt ? 'Refine' : 'Build brand kit'}
              </Button>
            }
          />
          <div
            className="rounded-[14px] border p-[22px] text-center"
            style={{
              background: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})`,
              borderColor: `${palette[2]}40`
            }}
          >
            <div className="flex items-center justify-center gap-2.5">
              <EarnCoin size={28} />
              <div className="text-[22px] font-semibold tracking-[-0.02em] text-white">{firm}</div>
            </div>
            <div
              className="mt-2 text-[12.5px]"
              style={{ color: kitBuilt ? palette[2] : 'rgba(255,255,255,0.6)' }}
            >
              {kitBuilt
                ? `${built.brandkit?.aesthetic} · ${built.brandkit?.voice} voice`
                : 'Your identity appears once your brand kit is built.'}
            </div>
          </div>
          <div className="mt-3.5 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-fg-4">Palette</span>
              {palette.map((c) => (
                <span
                  key={c}
                  className="h-[22px] w-[22px] rounded-md border border-hairline"
                  style={{ background: c }}
                />
              ))}
            </div>
            <div className="text-[11.5px] text-fg-4">
              <b className="text-fg-2">Aesthetic</b> ·{' '}
              {(built.brandkit?.aesthetic as string) || 'Institutional'}
            </div>
            <div className="text-[11.5px] text-fg-4">
              <b className="text-fg-2">Voice</b> · {(built.brandkit?.voice as string) || 'Measured'}
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-[18px]">
          <PanelHeader
            icon={Globe}
            title="Digital presence"
            eyebrow="Where LPs check you out · Noah & Vivian"
          />
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="flex items-center gap-2.5 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3">
              <span
                className={cn(
                  'flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border',
                  siteBuilt
                    ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                    : 'border-hairline bg-surface-2 text-fg-3'
                )}
              >
                {siteBuilt ? <Check size={16} aria-hidden /> : <Globe size={16} aria-hidden />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-fg-1">Fund website</div>
                <div className="truncate text-[10.5px] text-fg-5">
                  {siteBuilt
                    ? `${(built.website?.type as string) ?? 'One-pager'} · ${(built.website?.gate as string) ?? ''}`
                    : 'One-pager + gated room'}
                </div>
              </div>
              {siteBuilt ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Sparkles}
                  onClick={() => setOpenId('website')}
                >
                  Refine
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Sparkles}
                  onClick={() => setOpenId('website')}
                >
                  Build
                </Button>
              )}
            </div>
            {PRESENCE_ITEMS.map((it) => {
              const on = presence.includes(it.id);
              return (
                <div
                  key={it.id}
                  className="flex items-center gap-2.5 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3"
                >
                  <span
                    className={cn(
                      'flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border',
                      on
                        ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                        : 'border-hairline bg-surface-2 text-fg-3'
                    )}
                  >
                    {createElement(on ? Check : icon(it.icon), { size: 16, 'aria-hidden': true })}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-semibold text-fg-1">{it.name}</div>
                    <div className="truncate text-[10.5px] text-fg-5">{it.sub}</div>
                  </div>
                  {on ? (
                    <Badge tone="success" className="text-[9.5px]">
                      Live
                    </Badge>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={setupPending === it.id ? Loader2 : Plus}
                      disabled={setupPending === it.id}
                      onClick={() => setUp(it.id)}
                    >
                      {setupPending === it.id ? 'Saving…' : 'Set up'}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {(view === 'profile' || view === 'presence') && (
        <Card className="p-[18px]">
          <PanelHeader
            icon={Plug}
            title="Connections"
            eyebrow="Real integrations · keep everything in sync"
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CONNECTORS.map((c) => {
              const provider = CONNECTOR_PROVIDER[c.id];
              const on = provider ? !!connections[provider] : false;
              const tile = (
                <>
                  <span
                    className={cn(
                      'flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border',
                      on
                        ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                        : 'border-hairline bg-surface-2 text-fg-3'
                    )}
                  >
                    {createElement(icon(c.icon), { size: 16, 'aria-hidden': true })}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-fg-1">
                    {c.name}
                  </span>
                  <span
                    className={cn(
                      'flex-none text-[10.5px] font-semibold',
                      on ? 'text-success' : provider ? 'text-[var(--accent)]' : 'text-fg-5'
                    )}
                  >
                    {on ? 'Connected' : provider ? 'Connect' : 'Soon'}
                  </span>
                </>
              );
              const tileClass =
                'flex items-center gap-2.5 rounded-[11px] border px-3 py-2.5 text-left transition';
              if (!provider || on) {
                return (
                  <div
                    key={c.id}
                    className={cn(
                      tileClass,
                      on
                        ? 'border-[var(--success-line)] bg-[var(--success-soft)]'
                        : 'border-hairline bg-surface-1'
                    )}
                  >
                    {tile}
                  </div>
                );
              }
              return (
                <a
                  key={c.id}
                  href={`/api/integrations/${provider}/connect`}
                  className={cn(tileClass, 'border-hairline bg-surface-1 hover:bg-surface-2')}
                >
                  {tile}
                </a>
              );
            })}
          </div>
        </Card>
      )}

      <Card
        className="flex items-center gap-3 p-4"
        style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold-line)' }}
      >
        <EarnCoin size={26} />
        <div className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> Your brand should say the same thing your fund story
          does. I produce every asset from it — you set the posture, I keep it consistent
          everywhere.
        </div>
      </Card>
    </div>
  );
}
