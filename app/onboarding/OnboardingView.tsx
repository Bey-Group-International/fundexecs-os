'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Building2, Mail, User } from 'lucide-react';
import { Badge, Button, Card, Input, Select } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { OnboardingStepper } from '@/components/onboarding/OnboardingStepper';
import type { MemberProfile } from '@/lib/queries/member-profile';
import { ProofOfTruthFlow } from '@/components/proof-of-truth/ProofOfTruthFlow';
import { saveOnboardingIdentity } from './actions';

interface OnboardingViewProps {
  email: string;
  fullName: string;
  hasOrg: boolean;
  /** Seeded from `getMemberProfile()` so the Proof of Truth flow resumes. */
  profile: MemberProfile;
  /** Optional question id to jump to (from a Profile "close gap" deep-link). */
  focusField?: string;
}

const ROLES = [
  { value: 'managing_partner', label: 'Managing partner' },
  { value: 'principal', label: 'Principal' },
  { value: 'operator', label: 'Operator' },
  { value: 'limited_partner', label: 'Limited partner' },
  { value: 'capital_provider', label: 'Capital provider' },
  { value: 'advisor', label: 'Advisor' }
];

/**
 * Onboarding — captures identity + organization (for users without an org, the
 * server action (create_organization RPC + profiles full_name/role write), then
 * hands off into the conversational Proof of Truth profile builder where Earn
 * guides the member through their verified, member-type-specific profile.
 *
 * If the member already has an org (or has already started a profile), we skip
 * the identity step and go straight into the Proof of Truth flow — which itself
 * resumes from the saved draft.
 */
export function OnboardingView({
  email,
  fullName,
  hasOrg,
  profile,
  focusField
}: OnboardingViewProps) {
  const router = useRouter();

  // Skip the identity capture when there's nothing org-shaped left to collect
  // (the member already belongs to an org) or they've already begun a profile.
  const [stage, setStage] = useState<'identity' | 'profile'>(
    hasOrg || profile.memberType ? 'profile' : 'identity'
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(fullName);
  const [org, setOrg] = useState('');
  const [role, setRole] = useState(ROLES[0].value);
  const [orgType, setOrgType] = useState('fund');

  async function continueToProfile() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await saveOnboardingIdentity({
        fullName: name,
        role,
        organizationName: org,
        organizationType: orgType
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      setStage('profile');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (stage === 'profile') {
    return (
      <ProofOfTruthFlow
        profile={profile}
        redirectTo="/command-center"
        focusField={focusField}
        offerPassword
        email={email}
        showReferralNudge
      />
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-0 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-5 flex items-center gap-2.5">
          <EarnCoin size={30} className="flex-none" />
          <div className="text-base font-semibold tracking-[-0.02em]">
            FundExecs <span className="font-medium text-fg-4">OS</span>
          </div>
          <Badge tone="gold" className="ml-1 px-2 py-px text-[10.5px]">
            Proof of Truth
          </Badge>
        </div>

        <OnboardingStepper current="identity" className="mb-5" />

        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-3 bg-[linear-gradient(105deg,rgba(247,201,72,0.12),rgba(247,201,72,0.02)_46%,transparent_72%)] px-5 py-4">
            <EarnCoin size={40} glow online className="flex-none" />
            <div className="min-w-0">
              <div className="text-[14px] font-semibold tracking-[-0.015em] text-fg-1">
                Welcome — let&apos;s get you set up.
              </div>
              <p className="text-[11.5px] text-fg-4">
                <span className="font-medium text-fg-3">Earnest Fundmaker</span>, your
                private-market assistant, will then build your verified profile with you.
              </p>
            </div>
          </div>

          <div className="border-t border-hairline px-5 py-5">
            <div className="flex flex-col gap-4">
              <Input
                label="Full name"
                icon={User}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
              <Input label="Email" icon={Mail} value={email} readOnly />
              <Select
                label="Your role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                options={ROLES}
              />
              <Input
                label="Organization"
                icon={Building2}
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                placeholder="Your organization"
                required
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

              {error && (
                <p className="text-[12px] text-danger" role="alert">
                  {error}
                </p>
              )}

              <div className="mt-1 flex items-center justify-end">
                <Button
                  variant="primary"
                  iconRight={ArrowRight}
                  disabled={submitting}
                  onClick={continueToProfile}
                >
                  {submitting ? 'Saving…' : 'Continue to your profile'}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
