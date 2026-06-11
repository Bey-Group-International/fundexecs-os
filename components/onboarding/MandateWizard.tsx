'use client';

import { createElement, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Building2,
  Calculator,
  Banknote,
  Check,
  CheckCircle2,
  Compass,
  Database,
  Filter,
  GraduationCap,
  Handshake,
  IdCard,
  Infinity as InfinityIcon,
  Landmark,
  Layers,
  ListChecks,
  Megaphone,
  PenLine,
  Pencil,
  PieChart,
  Radar,
  Rocket,
  Scale,
  Search,
  Shuffle,
  Sparkles,
  Sprout,
  Target,
  TrendingUp,
  User,
  Users,
  type LucideIcon
} from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { FX_EASE } from '@/components/dashboard/command/motion';
import { cn } from '@/lib/utils';
import {
  DEFAULT_MANDATE,
  EXPERIENCE,
  GEOS,
  ROLE_GROUPS,
  SECTORS,
  STAGES,
  STANDING,
  groupDefaults,
  mandateCfg,
  specialistById,
  suggestFirmName,
  type Choice,
  type Mandate
} from '@/lib/onboarding/mandate';

/* ── icon resolver — maps the config's kebab names to lucide components ───── */
const ICONS: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  landmark: Landmark,
  handshake: Handshake,
  rocket: Rocket,
  radar: Radar,
  infinity: InfinityIcon,
  sprout: Sprout,
  'building-2': Building2,
  layers: Layers,
  search: Search,
  'graduation-cap': GraduationCap,
  'pie-chart': PieChart,
  users: Users,
  scale: Scale,
  calculator: Calculator,
  banknote: Banknote,
  compass: Compass,
  megaphone: Megaphone,
  filter: Filter,
  'pen-line': PenLine,
  target: Target,
  'id-card': IdCard,
  'list-checks': ListChecks,
  database: Database,
  'trending-up': TrendingUp
};
function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? Sparkles;
}

/** Renders a config-named icon without binding a component to a render-scoped
 *  capitalized variable (keeps the static-components lint rule happy). */
function DynIcon({
  name,
  size,
  strokeWidth,
  className
}: {
  name: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return createElement(iconFor(name), { size, strokeWidth, className, 'aria-hidden': true });
}

const STEPS = [
  { key: 'profile', label: 'Profile' },
  { key: 'mandate', label: 'Mandate' },
  { key: 'thesis', label: 'Thesis' },
  { key: 'review', label: 'Review' }
] as const;

/* ── small building blocks ───────────────────────────────────────────────── */

function ChoiceCard({
  icon,
  label,
  sub,
  note,
  recommended,
  selected,
  onClick
}: {
  icon: string;
  label: string;
  sub?: string;
  note?: string;
  recommended?: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-center gap-3 rounded-[14px] border px-3.5 py-3 text-left transition',
        selected
          ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] shadow-[0_0_0_1px_var(--accent-line)]'
          : 'border-hairline bg-surface-1 hover:bg-surface-2'
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 flex-none items-center justify-center rounded-[11px]',
          selected
            ? 'bg-[var(--accent)] text-white'
            : 'border border-hairline bg-surface-2 text-fg-3'
        )}
      >
        <DynIcon name={icon} size={18} strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[13.5px] font-semibold text-fg-1">{label}</span>
          {recommended && (
            <Badge tone="gold" className="px-1.5 py-px text-[9px]">
              Recommended
            </Badge>
          )}
        </span>
        {sub && <span className="mt-0.5 block text-[11.5px] text-fg-4">{sub}</span>}
        {note && (
          <span className="mt-0.5 flex items-center gap-1 text-[10.5px] text-gold-1">
            <Sparkles size={10} aria-hidden />
            {note}
          </span>
        )}
      </span>
      <span
        className={cn(
          'flex h-5 w-5 flex-none items-center justify-center rounded-full border',
          selected ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--border-strong)]'
        )}
      >
        {selected && <Check size={13} strokeWidth={2.4} className="text-white" aria-hidden />}
      </span>
    </button>
  );
}

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
        'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-medium transition',
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

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn('text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4', className)}
    >
      {children}
    </div>
  );
}

function ActsOn({ ids, text }: { ids: string[]; text: string }) {
  return (
    <div className="rounded-[13px] border border-hairline bg-surface-1 px-3.5 py-3">
      <Eyebrow className="mb-2 flex items-center gap-1.5">
        <Sparkles size={12} className="text-gold-1" aria-hidden />
        Who acts on this
      </Eyebrow>
      <div className="flex items-center gap-3">
        <div className="flex">
          {ids.map((id, i) => {
            const m = specialistById(id);
            const Ico = iconFor(m?.icon ?? 'sparkles');
            return (
              <span
                key={id}
                title={m?.name}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full border-2 border-bg-0 bg-surface-2 text-fg-2',
                  i > 0 && '-ml-2'
                )}
              >
                <Ico size={13} strokeWidth={1.9} aria-hidden />
              </span>
            );
          })}
        </div>
        <span className="flex-1 text-[12px] leading-relaxed text-fg-3">{text}</span>
      </div>
    </div>
  );
}

/* ── the wizard ──────────────────────────────────────────────────────────── */

export interface MandateWizardProps {
  initialName?: string;
  /** Persist the brief. Returns ok=false (with a message) to keep the user on Review. */
  onBrief: (mandate: Mandate) => Promise<{ ok: boolean; error?: string }>;
}

export function MandateWizard({ initialName = '', onBrief }: MandateWizardProps) {
  const reduced = useReducedMotion() ?? false;
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mandate, setMandate] = useState<Mandate>({ ...DEFAULT_MANDATE, principal: initialName });

  const set = <K extends keyof Mandate>(k: K, v: Mandate[K]) =>
    setMandate((p) => ({ ...p, [k]: v }));
  const toggleSector = (s: string) =>
    setMandate((p) => ({
      ...p,
      sectors: p.sectors.includes(s) ? p.sectors.filter((x) => x !== s) : [...p.sectors, s]
    }));

  const cfg = mandateCfg(mandate.investorGroup);
  const group = ROLE_GROUPS.find((g) => g.id === mandate.investorGroup) ?? ROLE_GROUPS[0];
  const objLabel = cfg.objectives.find((o) => o.id === mandate.objective)?.label ?? '—';
  const vehLabel = cfg.vehicles.find((v) => v.id === mandate.vehicle)?.label ?? '—';
  const sizeLabel = cfg.sizes.find((s) => s.id === mandate.size)?.label ?? '—';

  const back = () => setStep((s) => Math.max(0, s - 1));
  async function next() {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await onBrief(mandate);
    if (!res.ok) {
      setError(res.error ?? 'Something went wrong briefing the team. Please try again.');
      setSubmitting(false);
    }
    // On success the parent swaps to the activation screen; keep submitting=true.
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-bg-0 px-4 py-6">
      {/* header */}
      <div className="mx-auto flex w-full max-w-[640px] items-center gap-2.5">
        <EarnCoin size={26} className="flex-none" />
        <p className="text-[12.5px] text-fg-3">
          <span className="font-semibold text-fg-1">Brief your team.</span> Earn turns this into
          action — you only ever approve.
        </p>
      </div>

      {/* stepper */}
      <div className="mx-auto mt-4 flex w-full max-w-[640px] items-center gap-2">
        {STEPS.map((s, i) => {
          const done = i < step;
          const now = i === step;
          return (
            <div key={s.key} className="flex flex-1 items-center gap-2 last:flex-none">
              <button
                type="button"
                onClick={() => i < step && setStep(i)}
                className={cn(
                  'flex items-center gap-2',
                  i < step ? 'cursor-pointer' : 'cursor-default'
                )}
              >
                <span
                  className={cn(
                    'flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full text-[12px] font-semibold',
                    done || now
                      ? 'bg-[linear-gradient(135deg,#3B74F0,#2152D8)] text-white'
                      : 'border border-hairline bg-surface-2 text-fg-4'
                  )}
                >
                  {done ? <Check size={13} strokeWidth={2.4} aria-hidden /> : i + 1}
                </span>
                <span
                  className={cn(
                    'hidden text-[12.5px] font-medium sm:inline',
                    now ? 'text-fg-1' : 'text-fg-4'
                  )}
                >
                  {s.label}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    'h-0.5 flex-1 rounded-full',
                    i < step ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* step body */}
      <div className="mx-auto mt-6 w-full max-w-[640px] flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: reduced ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduced ? 0 : -8 }}
            transition={{ duration: 0.26, ease: FX_EASE }}
          >
            <Card className="p-6 sm:p-7">
              <Eyebrow className="mb-2">
                Step {step + 1} of {STEPS.length}
              </Eyebrow>

              {step === 0 && (
                <ProfileStep
                  mandate={mandate}
                  set={set}
                  setMandate={setMandate}
                  group={group}
                  cfgActs={['theodore', 'adrian', 'earn'].filter((id) => specialistById(id))}
                />
              )}
              {step === 1 && <MandateStep mandate={mandate} set={set} cfg={cfg} />}
              {step === 2 && <ThesisStep mandate={mandate} set={set} toggleSector={toggleSector} />}
              {step === 3 && (
                <ReviewStep
                  mandate={mandate}
                  cfg={cfg}
                  objLabel={objLabel}
                  vehLabel={vehLabel}
                  sizeLabel={sizeLabel}
                />
              )}

              {error && (
                <p className="mt-4 text-[12px] text-danger" role="alert">
                  {error}
                </p>
              )}

              <div className="mt-6 flex items-center justify-between">
                <Button
                  variant="ghost"
                  icon={ArrowLeft}
                  onClick={back}
                  disabled={step === 0 || submitting}
                >
                  Back
                </Button>
                <Button
                  variant={step === STEPS.length - 1 ? 'gold' : 'primary'}
                  iconRight={step === STEPS.length - 1 ? Sparkles : ArrowRight}
                  onClick={next}
                  disabled={submitting}
                >
                  {step === STEPS.length - 1
                    ? submitting
                      ? 'Briefing the team…'
                      : 'Brief the team'
                    : 'Continue'}
                </Button>
              </div>
            </Card>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── step 0 · profile ────────────────────────────────────────────────────── */
function ProfileStep({
  mandate,
  set,
  setMandate,
  group,
  cfgActs
}: {
  mandate: Mandate;
  set: <K extends keyof Mandate>(k: K, v: Mandate[K]) => void;
  setMandate: React.Dispatch<React.SetStateAction<Mandate>>;
  group: (typeof ROLE_GROUPS)[number];
  cfgActs: string[];
}) {
  return (
    <>
      <h2 className="text-[22px] font-semibold tracking-[-0.015em] text-fg-1">
        Your investor profile
      </h2>
      <p className="mt-1.5 mb-4 text-[13.5px] leading-relaxed text-fg-3">
        This is where we start. Tell the team who you are as an investor — it calibrates everything
        they do for you. First-timers and students are welcome; the team carries the experience you
        don&apos;t have yet.
      </p>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-fg-3">Your name</span>
          <div className="flex items-center gap-2 rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
            <User size={15} className="flex-none text-fg-4" aria-hidden />
            <input
              value={mandate.principal}
              onChange={(e) => set('principal', e.target.value)}
              placeholder="Jordan Avery"
              className="flex-1 bg-transparent text-[14px] text-fg-1 placeholder:text-fg-5 focus:outline-none"
            />
          </div>
        </label>

        <div>
          {!mandate.noFirm ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-fg-3">Fund or firm name</span>
              <div className="flex items-center gap-2 rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
                <Building2 size={15} className="flex-none text-fg-4" aria-hidden />
                <input
                  value={mandate.firm}
                  onChange={(e) => set('firm', e.target.value)}
                  placeholder="Acme Capital"
                  className="flex-1 bg-transparent text-[14px] text-fg-1 placeholder:text-fg-5 focus:outline-none"
                />
              </div>
              <span className="text-[11px] text-fg-5">Optional — you can start without one</span>
            </label>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-fg-3">
                Working title <span className="text-gold-1">· named by Earn</span>
              </span>
              <div className="flex items-center gap-2 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] py-2.5 pl-3 pr-2.5">
                <EarnCoin size={20} className="flex-none" />
                <span className="flex-1 text-[14px] font-semibold text-fg-1">
                  {mandate.firm || suggestFirmName(0)}
                </span>
                <button
                  type="button"
                  title="Suggest another"
                  onClick={() => {
                    const ns = mandate.firmSeed + 1;
                    setMandate((p) => ({ ...p, firmSeed: ns, firm: suggestFirmName(ns) }));
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--gold-line)] text-gold-1"
                >
                  <Shuffle size={14} aria-hidden />
                </button>
              </div>
              <span className="text-[11px] text-fg-5">
                You can rename it anytime — nothing&apos;s locked in.
              </span>
            </label>
          )}
          <button
            type="button"
            onClick={() =>
              setMandate((p) =>
                p.noFirm
                  ? { ...p, noFirm: false, firm: '' }
                  : { ...p, noFirm: true, firmSeed: 0, firm: suggestFirmName(0) }
              )
            }
            className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-[var(--accent)]"
          >
            {mandate.noFirm ? <Pencil size={13} aria-hidden /> : <Sparkles size={13} aria-hidden />}
            {mandate.noFirm ? 'Enter my own name instead' : "I don't have a fund name yet"}
          </button>
        </div>
      </div>

      <Eyebrow className="mb-2 mt-5">Describe yourself</Eyebrow>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {ROLE_GROUPS.map((g) => (
          <ChoiceCard
            key={g.id}
            icon={g.icon}
            label={g.label}
            sub={g.sub}
            selected={mandate.investorGroup === g.id}
            onClick={() =>
              setMandate((p) => ({
                ...p,
                investorGroup: g.id,
                investorRole: g.roles[0],
                ...groupDefaults(g.id)
              }))
            }
          />
        ))}
      </div>

      <Eyebrow className="mb-2 mt-4">Which best fits?</Eyebrow>
      <div className="flex flex-wrap gap-2">
        {group.roles.map((r) => (
          <Chip
            key={r}
            label={r}
            selected={mandate.investorRole === r}
            onClick={() => set('investorRole', r)}
          />
        ))}
      </div>
      {mandate.investorRole === 'Student-led fund' && (
        <p className="mt-2.5 flex items-center gap-2 text-[12px] text-gold-1">
          <Sparkles size={13} aria-hidden />
          No experience needed — the team carries it. Students launch and run real vehicles here.
        </p>
      )}

      <div className="grid grid-cols-1 gap-x-7 sm:grid-cols-2">
        <div>
          <Eyebrow className="mb-2 mt-5">Experience</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {EXPERIENCE.map((e) => (
              <Chip
                key={e}
                label={e}
                selected={mandate.experience === e}
                onClick={() => set('experience', e)}
              />
            ))}
          </div>
        </div>
        <div>
          <Eyebrow className="mb-2 mt-5">Standing</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {STANDING.map((s) => (
              <Chip
                key={s}
                label={s}
                selected={mandate.standing === s}
                onClick={() => set('standing', s)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5">
        <ActsOn
          ids={cfgActs}
          text="Theodore calibrates the playbook to your role and experience, Adrian sets the right compliance path for your standing, and Earn tunes how much it does for you."
        />
      </div>
    </>
  );
}

/* ── step 1 · mandate ────────────────────────────────────────────────────── */
function MandateStep({
  mandate,
  set,
  cfg
}: {
  mandate: Mandate;
  set: <K extends keyof Mandate>(k: K, v: Mandate[K]) => void;
  cfg: ReturnType<typeof mandateCfg>;
}) {
  return (
    <>
      <h2 className="text-[22px] font-semibold tracking-[-0.015em] text-fg-1">{cfg.heading}</h2>
      <p className="mt-1.5 mb-4 text-[13.5px] leading-relaxed text-fg-3">{cfg.sub}</p>

      <Eyebrow className="mb-2">{cfg.objLabel}</Eyebrow>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {cfg.objectives.map((o: Choice) => (
          <ChoiceCard
            key={o.id}
            icon={o.icon}
            label={o.label}
            sub={o.sub}
            recommended={o.recommended}
            selected={mandate.objective === o.id}
            onClick={() => set('objective', o.id)}
          />
        ))}
      </div>

      <Eyebrow className="mb-2 mt-5">{cfg.vehLabel}</Eyebrow>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {cfg.vehicles.map((v: Choice) => (
          <ChoiceCard
            key={v.id}
            icon={v.icon}
            label={v.label}
            note={v.note}
            selected={mandate.vehicle === v.id}
            onClick={() => set('vehicle', v.id)}
          />
        ))}
      </div>

      <Eyebrow className="mb-2 mt-5">{cfg.sizeLabel}</Eyebrow>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {cfg.sizes.map((s) => {
          const on = mandate.size === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => set('size', s.id)}
              className={cn(
                'rounded-[13px] border px-2 py-3.5 text-center transition',
                on
                  ? 'border-[var(--gold-line)] bg-[var(--gold-soft)]'
                  : 'border-hairline bg-surface-1 hover:bg-surface-2'
              )}
            >
              <div
                className={cn(
                  'text-[18px] font-semibold tabular-nums',
                  on ? 'text-gold-1' : 'text-fg-1'
                )}
              >
                {s.label}
              </div>
              <div className="mt-0.5 text-[10.5px] text-fg-4">{s.sub}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        <ActsOn ids={cfg.acts} text={cfg.actsText} />
      </div>
    </>
  );
}

/* ── step 2 · thesis ─────────────────────────────────────────────────────── */
function ThesisStep({
  mandate,
  set,
  toggleSector
}: {
  mandate: Mandate;
  set: <K extends keyof Mandate>(k: K, v: Mandate[K]) => void;
  toggleSector: (s: string) => void;
}) {
  return (
    <>
      <h2 className="text-[22px] font-semibold tracking-[-0.015em] text-fg-1">
        What&apos;s your thesis?
      </h2>
      <p className="mt-1.5 mb-4 text-[13.5px] leading-relaxed text-fg-3">
        Where you&apos;ll hunt. Rough is fine — Earn sharpens it. This is how the team knows what to
        source and who to raise from.
      </p>

      <Eyebrow className="mb-2">
        Sectors{' '}
        <span className="font-normal normal-case tracking-normal text-fg-5">· pick any</span>
      </Eyebrow>
      <div className="flex flex-wrap gap-2">
        {SECTORS.map((s) => (
          <Chip
            key={s}
            label={s}
            selected={mandate.sectors.includes(s)}
            onClick={() => toggleSector(s)}
          />
        ))}
      </div>

      <Eyebrow className="mb-2 mt-5">Stage</Eyebrow>
      <div className="flex flex-wrap gap-2">
        {STAGES.map((s) => (
          <Chip key={s} label={s} selected={mandate.stage === s} onClick={() => set('stage', s)} />
        ))}
      </div>

      <Eyebrow className="mb-2 mt-5">Geography</Eyebrow>
      <div className="flex flex-wrap gap-2">
        {GEOS.map((g) => (
          <Chip key={g} label={g} selected={mandate.geo === g} onClick={() => set('geo', g)} />
        ))}
      </div>

      <div className="mt-5">
        <ActsOn
          ids={['marcus', 'theodore']}
          text="Marcus sources on-thesis deals against this. Theodore pressure-tests the thesis before anything reaches your desk."
        />
      </div>
    </>
  );
}

/* ── step 3 · review ─────────────────────────────────────────────────────── */
function ReviewStep({
  mandate,
  cfg,
  objLabel,
  vehLabel,
  sizeLabel
}: {
  mandate: Mandate;
  cfg: ReturnType<typeof mandateCfg>;
  objLabel: string;
  vehLabel: string;
  sizeLabel: string;
}) {
  const rows: [string, string][] = [
    ['Principal', mandate.principal || '—'],
    ['Firm', mandate.firm || '—'],
    ['Investor', `${mandate.investorRole} · ${mandate.experience}`],
    ['Standing', mandate.standing],
    ['Objective', objLabel],
    [cfg.vehLabel, vehLabel],
    [cfg.sizeLabel, sizeLabel],
    ['Thesis', `${mandate.sectors.join(', ') || 'Generalist'} · ${mandate.stage}`],
    ['Geography', mandate.geo]
  ];
  return (
    <>
      <h2 className="text-[22px] font-semibold tracking-[-0.015em] text-fg-1">
        Your mandate, ready to brief
      </h2>
      <p className="mt-1.5 mb-4 text-[13.5px] leading-relaxed text-fg-3">
        Confirm and the whole team goes to work building your desk. You&apos;ll review everything
        before anything is sent.
      </p>

      <div className="overflow-hidden rounded-[14px] border border-hairline">
        {rows.map(([k, v], i) => (
          <div
            key={k}
            className={cn(
              'flex gap-3.5 px-4 py-2.5',
              i % 2 === 0 ? 'bg-surface-1' : 'bg-transparent',
              i > 0 && 'border-t border-[var(--border-faint)]'
            )}
          >
            <span className="w-[110px] flex-none text-[12px] text-fg-4">{k}</span>
            <span className="text-[13.5px] font-medium text-fg-1">{v}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3.5 py-2.5">
        <EarnCoin size={22} className="flex-none" />
        <span className="text-[12px] font-medium text-gold-1">
          Briefing the team earns your first +150 XP — Level 1: Operator.
        </span>
      </div>
    </>
  );
}
