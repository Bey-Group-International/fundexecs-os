'use client';

import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Pencil,
  Shuffle,
  Sparkles,
  User
} from 'lucide-react';
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
  type InvestorGroup,
  type Mandate
} from '@/lib/onboarding/mandate';
import { MandateIcon } from '@/components/ui/MandateIcon';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Field } from '@/components/ui/Field';

const STEPS = ['Profile', 'Mandate', 'Thesis', 'Review'] as const;

/* ── small pieces (the prototype's ChoiceCard / Chip / ActsOn) ───────────── */

function ChoiceCard({
  icon,
  label,
  sub,
  note,
  selected,
  recommended,
  compact,
  onClick
}: {
  icon: string;
  label: string;
  sub?: string;
  note?: string;
  selected: boolean;
  recommended?: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-[14px] border text-left transition',
        compact ? 'px-3.5 py-3' : 'px-4 py-3.5',
        selected
          ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] shadow-[0_0_0_1px_var(--accent-line)]'
          : 'border-hairline bg-surface-1 hover:bg-surface-2'
      )}
    >
      <span
        className={cn(
          'flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px]',
          selected
            ? 'bg-[var(--accent)] text-white'
            : 'border border-hairline bg-surface-2 text-fg-3'
        )}
      >
        <MandateIcon name={icon} size={19} strokeWidth={1.9} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-fg-1">{label}</span>
          {recommended && (
            <Badge tone="gold" className="px-1.5 py-0 text-[9px]">
              Recommended
            </Badge>
          )}
        </span>
        {sub && <span className="mt-0.5 block text-[12px] text-fg-4">{sub}</span>}
        {note && (
          <span className="mt-1 flex items-center gap-1 text-[11px] text-gold-1">
            <Sparkles size={11} aria-hidden />
            {note}
          </span>
        )}
      </span>
      <span
        className={cn(
          'flex h-5 w-5 flex-none items-center justify-center rounded-full border-[1.5px]',
          selected ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-hairline-strong'
        )}
        aria-hidden
      >
        {selected && <Check size={13} className="text-white" />}
      </span>
    </button>
  );
}

/** Who acts on this step — teaches "the team does the work". */
function ActsOn({ ids, text }: { ids: string[]; text: string }) {
  return (
    <div className="rounded-[13px] border border-hairline bg-surface-1 px-3.5 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
        <Sparkles size={12} className="text-gold-1" aria-hidden />
        Who acts on this
      </div>
      <div className="flex items-center gap-3">
        <div className="flex">
          {ids.map((id, i) => {
            const specialist = specialistById(id);
            return (
              <span
                key={id}
                className={cn('inline-flex rounded-full border-2 border-bg-1', i > 0 && '-ml-2')}
              >
                {specialist ? (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1">
                    <MandateIcon name={specialist.icon} size={13} strokeWidth={1.9} aria-hidden />
                  </span>
                ) : (
                  <EarnCoin size={28} />
                )}
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
  initialName: string;
  onBrief: (mandate: Mandate) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * The Mandate Brief — a four-step, role-aware wizard (Profile → Mandate →
 * Thesis → Review) ported from the simplified onboarding prototype. The
 * config (role families, objectives, vehicles, sizes, thesis options) lives
 * in `lib/onboarding/mandate`; this component only renders and assembles the
 * `Mandate` the server action persists.
 */
export function MandateWizard({ initialName, onBrief }: MandateWizardProps) {
  const [step, setStep] = useState(0);
  const [mandate, setMandate] = useState<Mandate>({
    ...DEFAULT_MANDATE,
    principal: initialName
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Mandate>(key: K, value: Mandate[K]) =>
    setMandate((p) => ({ ...p, [key]: value }));
  const toggleSector = (s: string) =>
    setMandate((p) => ({
      ...p,
      sectors: p.sectors.includes(s) ? p.sectors.filter((x) => x !== s) : [...p.sectors, s]
    }));
  const pickGroup = (group: InvestorGroup) =>
    setMandate((p) => ({
      ...p,
      investorGroup: group,
      investorRole: ROLE_GROUPS.find((g) => g.id === group)?.roles[0] ?? p.investorRole,
      ...groupDefaults(group)
    }));
  const toggleNoFirm = () =>
    setMandate((p) =>
      p.noFirm
        ? { ...p, noFirm: false, firm: '' }
        : { ...p, noFirm: true, firmSeed: 0, firm: suggestFirmName(0) }
    );
  const shuffleFirm = () =>
    setMandate((p) => {
      const next = (p.firmSeed || 0) + 1;
      return { ...p, firmSeed: next, firm: suggestFirmName(next) };
    });

  const cfg = mandateCfg(mandate.investorGroup);
  const group = ROLE_GROUPS.find((g) => g.id === mandate.investorGroup) ?? ROLE_GROUPS[0];
  const objLabel = cfg.objectives.find((o) => o.id === mandate.objective)?.label ?? '—';
  const vehLabel = cfg.vehicles.find((v) => v.id === mandate.vehicle)?.label ?? '—';
  const sizeLabel = cfg.sizes.find((s) => s.id === mandate.size)?.label ?? '—';

  const lastStep = step === STEPS.length - 1;

  async function next() {
    if (!lastStep) {
      setStep(step + 1);
      return;
    }
    if (!mandate.principal.trim() || !mandate.firm.trim()) {
      setError(
        'Add your name and a fund or firm name — or let Earn suggest a working title on the Profile step.'
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await onBrief(mandate);
    if (!res.ok) {
      setError(res.error ?? 'Could not brief the team. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-bg-0 text-fg-1">
      <AuroraBackdrop />

      {/* header + stepper */}
      <div className="relative z-10 px-[clamp(16px,4vw,28px)] pt-6">
        <div className="mx-auto flex w-full max-w-[640px] items-center gap-3">
          <EarnCoin size={26} />
          <p className="text-[12.5px] text-fg-3">
            <b className="font-semibold text-fg-1">Brief your team.</b> Earn turns this into action
            — you only ever approve.
          </p>
        </div>
        <div className="mx-auto mt-4 flex w-full max-w-[640px] items-center gap-2">
          {STEPS.map((label, i) => {
            const done = i < step;
            const now = i === step;
            return (
              <div key={label} className="contents">
                <button
                  type="button"
                  onClick={() => done && setStep(i)}
                  aria-label={`Step ${i + 1}: ${label}${done ? ' (completed)' : ''}`}
                  aria-current={now ? 'step' : undefined}
                  className={cn(
                    'flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full text-[12px] font-semibold',
                    done || now
                      ? 'bg-[linear-gradient(135deg,#3B74F0,#2152D8)] text-white'
                      : 'border border-hairline bg-surface-2 text-fg-4',
                    done ? 'cursor-pointer' : 'cursor-default'
                  )}
                >
                  {done ? <Check size={13} aria-hidden /> : i + 1}
                </button>
                {i < STEPS.length - 1 && (
                  <div
                    className={cn(
                      'h-0.5 flex-1 rounded-full',
                      i < step ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
                    )}
                    aria-hidden
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* step body */}
      <div className="relative z-10 flex flex-1 flex-col items-center px-[clamp(16px,4vw,28px)] py-6">
        <div
          key={step}
          className="fx-rise w-full max-w-[640px] rounded-2xl border border-hairline bg-bg-1 p-[clamp(20px,4vw,30px)] shadow-[var(--shadow-md)]"
        >
          <Eyebrow className="mb-2">
            Step {step + 1} of {STEPS.length}
          </Eyebrow>

          {step === 0 && (
            <>
              <h1 className="text-[22px] font-semibold tracking-[-0.02em]">
                Your investor profile
              </h1>
              <p className="mb-5 mt-2 text-[13.5px] leading-relaxed text-fg-3">
                This is where we start. Tell the team who you are as an investor — it calibrates
                everything they do for you. First-timers and students are welcome; the team carries
                the experience you don&rsquo;t have yet.
              </p>

              <div className="mb-5 grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                <Field
                  label="Your name"
                  icon={User}
                  value={mandate.principal}
                  onChange={(v) => set('principal', v)}
                  placeholder="Jordan Avery"
                />
                <div>
                  {!mandate.noFirm ? (
                    <Field
                      label="Fund or firm name"
                      icon={Building2}
                      value={mandate.firm}
                      onChange={(v) => set('firm', v)}
                      placeholder="Acme Capital"
                      hint="This names your workspace — you can rename it anytime."
                    />
                  ) : (
                    <div>
                      <span className="text-[12.5px] font-medium text-fg-3">
                        Working title <span className="text-gold-1">· named by Earn</span>
                      </span>
                      <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] py-2 pl-3 pr-2">
                        <EarnCoin size={20} />
                        <span className="flex-1 text-[14px] font-semibold text-fg-1">
                          {mandate.firm || suggestFirmName(0)}
                        </span>
                        <button
                          type="button"
                          title="Suggest another"
                          onClick={shuffleFirm}
                          className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-[var(--gold-line)] text-gold-1 transition hover:bg-[var(--gold-soft)]"
                        >
                          <Shuffle size={14} aria-hidden />
                        </button>
                      </div>
                      <p className="mt-1.5 text-[11.5px] text-fg-5">
                        You can rename it anytime — nothing&rsquo;s locked in.
                      </p>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={toggleNoFirm}
                    className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-[var(--accent)] transition hover:brightness-125"
                  >
                    {mandate.noFirm ? (
                      <Pencil size={13} aria-hidden />
                    ) : (
                      <Sparkles size={13} aria-hidden />
                    )}
                    {mandate.noFirm ? 'Enter my own name instead' : "I don't have a fund name yet"}
                  </button>
                </div>
              </div>

              <Eyebrow className="mb-2.5">Describe yourself</Eyebrow>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                {ROLE_GROUPS.map((g) => (
                  <ChoiceCard
                    key={g.id}
                    icon={g.icon}
                    label={g.label}
                    sub={g.sub}
                    compact
                    selected={mandate.investorGroup === g.id}
                    onClick={() => pickGroup(g.id)}
                  />
                ))}
              </div>

              <Eyebrow className="mb-2.5 mt-4">Which best fits?</Eyebrow>
              <div className="flex flex-wrap gap-2">
                {group.roles.map((r) => (
                  <Chip
                    size="lg"
                    key={r}
                    label={r}
                    selected={mandate.investorRole === r}
                    onClick={() => set('investorRole', r)}
                  />
                ))}
              </div>
              {mandate.investorRole === 'Student-led fund' && (
                <p className="mt-3 flex items-center gap-2 text-[12px] text-gold-1">
                  <Sparkles size={13} aria-hidden />
                  No experience needed — the team carries it. Students launch and run real vehicles
                  here.
                </p>
              )}

              <div className="grid grid-cols-1 gap-x-7 sm:grid-cols-2">
                <div>
                  <Eyebrow className="mb-2.5 mt-5">Experience</Eyebrow>
                  <div className="flex flex-wrap gap-2">
                    {EXPERIENCE.map((e) => (
                      <Chip
                        size="lg"
                        key={e}
                        label={e}
                        selected={mandate.experience === e}
                        onClick={() => set('experience', e)}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <Eyebrow className="mb-2.5 mt-5">Standing</Eyebrow>
                  <div className="flex flex-wrap gap-2">
                    {STANDING.map((s) => (
                      <Chip
                        size="lg"
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
                  ids={['theodore', 'adrian', 'earn']}
                  text="Theodore calibrates the playbook to your role and experience, Adrian sets the right compliance path for your standing, and Earn tunes how much it does for you."
                />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{cfg.heading}</h1>
              <p className="mb-5 mt-2 text-[13.5px] leading-relaxed text-fg-3">{cfg.sub}</p>

              <Eyebrow className="mb-2.5">{cfg.objLabel}</Eyebrow>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {cfg.objectives.map((o) => (
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

              <Eyebrow className="mb-2.5 mt-6">{cfg.vehLabel}</Eyebrow>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {cfg.vehicles.map((v) => (
                  <ChoiceCard
                    key={v.id}
                    icon={v.icon}
                    label={v.label}
                    note={v.note}
                    compact
                    selected={mandate.vehicle === v.id}
                    onClick={() => set('vehicle', v.id)}
                  />
                ))}
              </div>

              <Eyebrow className="mb-2.5 mt-6">{cfg.sizeLabel}</Eyebrow>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {cfg.sizes.map((s) => {
                  const on = mandate.size === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => set('size', s.id)}
                      aria-pressed={on}
                      className={cn(
                        'rounded-[13px] border px-2 py-3.5 text-center transition',
                        on
                          ? 'border-[var(--gold-line)] bg-[var(--gold-soft)]'
                          : 'border-hairline bg-surface-1 hover:bg-surface-2'
                      )}
                    >
                      <div
                        className={cn(
                          "text-[18px] font-semibold [font-feature-settings:'tnum']",
                          on ? 'text-gold-1' : 'text-fg-1'
                        )}
                      >
                        {s.label}
                      </div>
                      <div className="mt-1 text-[10.5px] text-fg-4">{s.sub}</div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5">
                <ActsOn ids={cfg.acts} text={cfg.actsText} />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="text-[22px] font-semibold tracking-[-0.02em]">
                What&rsquo;s your thesis?
              </h1>
              <p className="mb-5 mt-2 text-[13.5px] leading-relaxed text-fg-3">
                Where you&rsquo;ll hunt. Rough is fine — Earn sharpens it. This is how the team
                knows what to source and who to raise from.
              </p>

              <Eyebrow className="mb-2.5">
                Sectors <span className="font-normal normal-case tracking-normal">· pick any</span>
              </Eyebrow>
              <div className="flex flex-wrap gap-2">
                {SECTORS.map((s) => (
                  <Chip
                    size="lg"
                    key={s}
                    label={s}
                    selected={mandate.sectors.includes(s)}
                    onClick={() => toggleSector(s)}
                  />
                ))}
              </div>

              <Eyebrow className="mb-2.5 mt-6">Stage</Eyebrow>
              <div className="flex flex-wrap gap-2">
                {STAGES.map((s) => (
                  <Chip
                    size="lg"
                    key={s}
                    label={s}
                    selected={mandate.stage === s}
                    onClick={() => set('stage', s)}
                  />
                ))}
              </div>

              <Eyebrow className="mb-2.5 mt-6">Geography</Eyebrow>
              <div className="flex flex-wrap gap-2">
                {GEOS.map((g) => (
                  <Chip
                    size="lg"
                    key={g}
                    label={g}
                    selected={mandate.geo === g}
                    onClick={() => set('geo', g)}
                  />
                ))}
              </div>

              <div className="mt-5">
                <ActsOn
                  ids={['marcus', 'theodore']}
                  text="Marcus sources on-thesis deals against this. Theodore pressure-tests the thesis before anything reaches your desk."
                />
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="text-[22px] font-semibold tracking-[-0.02em]">
                Your mandate, ready to brief
              </h1>
              <p className="mb-5 mt-2 text-[13.5px] leading-relaxed text-fg-3">
                Confirm and the whole team goes to work building your desk. You&rsquo;ll review
                everything before anything is sent.
              </p>

              <div className="overflow-hidden rounded-[14px] border border-hairline">
                {(
                  [
                    ['Principal', mandate.principal || '—'],
                    ['Firm', mandate.firm || '—'],
                    ['Investor', `${mandate.investorRole} · ${mandate.experience}`],
                    ['Standing', mandate.standing],
                    ['Objective', objLabel],
                    [cfg.vehLabel, vehLabel],
                    [cfg.sizeLabel, sizeLabel],
                    ['Thesis', `${mandate.sectors.join(', ') || 'Generalist'} · ${mandate.stage}`],
                    ['Geography', mandate.geo]
                  ] as const
                ).map(([k, v], i) => (
                  <div
                    key={k}
                    className={cn(
                      'flex gap-3.5 px-4 py-2.5',
                      i % 2 === 0 && 'bg-surface-1',
                      i > 0 && 'border-t border-hairline-faint'
                    )}
                  >
                    <span className="w-[110px] flex-none text-[12px] text-fg-4">{k}</span>
                    <span className="text-[13.5px] font-medium text-fg-1">{v}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3.5 py-2.5">
                <EarnCoin size={22} />
                <span className="text-[12px] font-medium text-gold-1">
                  Briefing the team earns your first +150 XP — Level 1: Operator.
                </span>
              </div>

              {error && (
                <p className="mt-4 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-[12.5px] text-danger">
                  {error}
                </p>
              )}
            </>
          )}

          {/* footer nav */}
          <div className="mt-7 flex items-center justify-between">
            <Button
              variant="ghost"
              onClick={() => step > 0 && setStep(step - 1)}
              disabled={step === 0 || submitting}
            >
              <ArrowLeft size={15} aria-hidden />
              Back
            </Button>
            <Button variant={lastStep ? 'gold' : 'primary'} onClick={next} disabled={submitting}>
              {submitting ? 'Briefing the team…' : lastStep ? 'Brief the team' : 'Continue'}
              {!submitting &&
                (lastStep ? (
                  <Sparkles size={15} aria-hidden />
                ) : (
                  <ArrowRight size={15} aria-hidden />
                ))}
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
