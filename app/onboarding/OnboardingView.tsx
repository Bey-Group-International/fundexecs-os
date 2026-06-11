'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MemberProfile } from '@/lib/queries/member-profile';
import { ProofOfTruthFlow } from '@/components/proof-of-truth/ProofOfTruthFlow';
import { MandateWizard } from '@/components/onboarding/MandateWizard';
import { MandateActivation } from '@/components/onboarding/MandateActivation';
import type { Mandate } from '@/lib/onboarding/mandate';
import { briefTheTeam } from './actions';

interface OnboardingViewProps {
  email: string;
  fullName: string;
  hasOrg: boolean;
  /** Seeded from `getMemberProfile()` so the Proof of Truth flow resumes. */
  profile: MemberProfile;
  /** Optional question id to jump to (from a Profile "close gap" deep-link). */
  focusField?: string;
}

/**
 * Onboarding — the Mandate Brief.
 *
 * Fresh members give their executive team its marching orders through a short,
 * role-aware wizard (`MandateWizard`); on submit the server creates the org +
 * membership, sets the member type, persists the mandate, and marks the profile
 * `complete` (the gate the middleware checks). We then play the activation
 * "aha" — the team turning the brief into a working desk — and drop the member
 * into their command center.
 *
 * The conversational Proof of Truth builder still powers deeper, field-level
 * profile editing: a `?focus=<questionId>` deep-link from the Profile lands
 * straight there rather than re-running the brief.
 */
export function OnboardingView({ email, fullName, profile, focusField }: OnboardingViewProps) {
  const router = useRouter();

  // A "close gap" deep-link edits one verified field — keep the conversational
  // builder for that; the brief is only for first-run setup.
  const [stage, setStage] = useState<'brief' | 'activating' | 'profile'>(
    focusField ? 'profile' : 'brief'
  );
  const [briefed, setBriefed] = useState<Mandate | null>(null);

  async function handleBrief(mandate: Mandate): Promise<{ ok: boolean; error?: string }> {
    const res = await briefTheTeam(mandate);
    if (res.ok) {
      setBriefed(mandate);
      // Make sure layout/middleware see the now-complete profile.
      router.refresh();
      setStage('activating');
    }
    return res;
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

  if (stage === 'activating' && briefed) {
    return <MandateActivation mandate={briefed} onDone={() => router.push('/command-center')} />;
  }

  return <MandateWizard initialName={fullName} onBrief={handleBrief} />;
}
