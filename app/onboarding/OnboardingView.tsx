'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Globe,
  Link2,
  Mail,
  Sparkles,
  User,
  Zap,
  type LucideIcon
} from 'lucide-react';
import { Badge, Button, Card, Input, ProgressBar, Select } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { createClient } from '@/lib/supabase/client';

interface OnboardingViewProps {
  email: string;
  fullName: string;
  hasOrg: boolean;
}

interface StepDef {
  id: string;
  label: string;
  icon: LucideIcon;
}

const STEPS: StepDef[] = [
  { id: 'identity', label: 'Identity', icon: User },
  { id: 'role', label: 'Role', icon: Building2 },
  { id: 'socials', label: 'Socials', icon: Globe },
  { id: 'review', label: 'Review', icon: Check }
];

const ROLES = [
  { value: 'managing_partner', label: 'Managing partner' },
  { value: 'principal', label: 'Principal' },
  { value: 'operator', label: 'Operator' },
  { value: 'limited_partner', label: 'Limited partner' },
  { value: 'capital_provider', label: 'Capital provider' },
  { value: 'advisor', label: 'Advisor' }
];

function roleLabel(value: string): string {
  return ROLES.find((r) => r.value === value)?.label ?? value;
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.id} className="flex flex-1 items-center gap-2">
            <span
              className={
                done || active
                  ? 'inline-flex h-8 w-8 flex-none items-center justify-center rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1'
                  : 'inline-flex h-8 w-8 flex-none items-center justify-center rounded-full border border-hairline bg-surface-1 text-fg-5'
              }
            >
              {done ? (
                <Check size={15} strokeWidth={2.2} aria-hidden />
              ) : (
                <Icon size={15} strokeWidth={1.9} aria-hidden />
              )}
            </span>
            <span
              className={
                active
                  ? 'hidden text-[12.5px] font-semibold text-fg-1 sm:inline'
                  : 'hidden text-[12.5px] font-medium text-fg-4 sm:inline'
              }
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-hairline" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-hairline py-2.5 last:border-0">
      <span className="text-[12px] text-fg-4">{label}</span>
      <span className="truncate text-[12.5px] font-medium text-fg-1">{value || '—'}</span>
    </div>
  );
}

export function OnboardingView({ email, fullName, hasOrg }: OnboardingViewProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(fullName);
  const [org, setOrg] = useState('');
  const [role, setRole] = useState(ROLES[0].value);
  const [orgType, setOrgType] = useState('fund');
  const [linkedin, setLinkedin] = useState('');
  const [website, setWebsite] = useState('');

  const pct = Math.round(((step + (done ? 1 : 0)) / STEPS.length) * 100);
  const last = step === STEPS.length - 1;

  async function finish() {
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    try {
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }

      if (!hasOrg && org.trim()) {
        const { error: rpcError } = await supabase.rpc('create_organization', {
          _name: org.trim(),
          _type: orgType as never
        });
        if (rpcError) throw rpcError;
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ role, full_name: name.trim() || undefined })
        .eq('id', user.id);
      if (profileError) throw profileError;

      setDone(true);
      setTimeout(() => router.push('/command-center'), 1100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-0 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="inline-flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg bg-gradient-to-br from-gold-1 to-gold-2 text-[15px] font-bold text-[#070b14]">
            F
          </span>
          <div className="text-base font-semibold tracking-[-0.02em]">
            FundExecs <span className="font-medium text-fg-4">OS</span>
          </div>
        </div>

        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-3 bg-[linear-gradient(105deg,rgba(247,201,72,0.12),rgba(247,201,72,0.02)_46%,transparent_72%)] px-5 py-4">
            <EarnCoin size={40} glow online className="flex-none" />
            <div className="min-w-0">
              <div className="text-[14px] font-semibold tracking-[-0.015em] text-fg-1">
                Welcome — let&apos;s get you set up.
              </div>
              <p className="text-[11.5px] text-fg-4">
                <span className="font-medium text-fg-3">Earnest Fundmaker</span>, your
                private-market assistant, will tailor your workspace.
              </p>
            </div>
          </div>

          <div className="border-t border-hairline px-5 py-5">
            <Stepper current={done ? STEPS.length : step} />
            <ProgressBar
              value={pct}
              height={6}
              gradient="linear-gradient(90deg,#F7C948,#E5A823)"
              className="mt-4"
            />

            {done ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1">
                  <Check size={22} strokeWidth={2.2} aria-hidden />
                </span>
                <div className="text-[15px] font-semibold text-fg-1">You&apos;re all set</div>
                <Badge tone="gold" className="gap-1 px-2.5 py-1 text-[11.5px]">
                  <Zap size={13} strokeWidth={2.2} aria-hidden />
                  +150 XP
                </Badge>
                <p className="text-[12px] text-fg-4">Taking you to your Command Center…</p>
              </div>
            ) : (
              <div className="mt-5 flex flex-col gap-4">
                {step === 0 && (
                  <>
                    <Input
                      label="Full name"
                      icon={User}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                    />
                    <Input label="Email" icon={Mail} value={email} readOnly />
                  </>
                )}

                {step === 1 && (
                  <>
                    <Select
                      label="Your role"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      options={ROLES}
                    />
                    {!hasOrg && (
                      <>
                        <Input
                          label="Organization"
                          icon={Building2}
                          value={org}
                          onChange={(e) => setOrg(e.target.value)}
                          placeholder="Your organization"
                        />
                        <Select
                          label="Organization type"
                          value={orgType}
                          onChange={(e) => setOrgType(e.target.value)}
                          options={[
                            { value: 'fund', label: 'Fund' },
                            { value: 'lp', label: 'Limited partner' },
                            { value: 'operator', label: 'Operator' },
                            { value: 'capital_provider', label: 'Capital provider' },
                            { value: 'service_provider', label: 'Service provider' },
                            { value: 'partner', label: 'Partner' }
                          ]}
                        />
                      </>
                    )}
                  </>
                )}

                {step === 2 && (
                  <>
                    <Input
                      label="LinkedIn"
                      icon={Link2}
                      value={linkedin}
                      onChange={(e) => setLinkedin(e.target.value)}
                      placeholder="linkedin.com/in/you"
                    />
                    <Input
                      label="Website"
                      icon={Globe}
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="yourfund.com"
                    />
                    <p className="text-[11.5px] text-fg-5">
                      Optional — Earn uses these to enrich your LP-facing profile.
                    </p>
                  </>
                )}

                {step === 3 && (
                  <div className="rounded-xl border border-hairline bg-surface-1 px-4 py-2">
                    <Row label="Name" value={name} />
                    <Row label="Email" value={email} />
                    <Row label="Role" value={roleLabel(role)} />
                    {!hasOrg && <Row label="Organization" value={org} />}
                    <Row label="LinkedIn" value={linkedin} />
                    <Row label="Website" value={website} />
                  </div>
                )}

                {error && (
                  <p className="text-[12px] text-danger" role="alert">
                    {error}
                  </p>
                )}

                <div className="mt-1 flex items-center justify-between gap-3">
                  <Button
                    variant="ghost"
                    icon={ArrowLeft}
                    disabled={step === 0 || submitting}
                    onClick={() => setStep((s) => Math.max(0, s - 1))}
                  >
                    Back
                  </Button>
                  {last ? (
                    <Button
                      variant="primary"
                      icon={Sparkles}
                      disabled={submitting}
                      onClick={finish}
                    >
                      {submitting ? 'Finishing…' : 'Finish setup'}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      iconRight={ArrowRight}
                      onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                    >
                      Continue
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
