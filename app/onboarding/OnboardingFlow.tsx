'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Mandate } from '@/lib/onboarding/mandate';
import { MandateWizard } from '@/components/onboarding/MandateWizard';
import { MandateActivation } from '@/components/onboarding/MandateActivation';
import { briefTheTeam } from './actions';

/**
 * The onboarding spine: Mandate Brief → team activation → command center.
 * On submit the server creates the org + membership, sets the member type,
 * persists the mandate, and marks the profile `complete` (the middleware
 * gate); the activation "aha" then plays while the workspace settles.
 */
export function OnboardingFlow({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<'brief' | 'activating'>('brief');
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

  if (stage === 'activating' && briefed) {
    return <MandateActivation mandate={briefed} onDone={() => router.push('/command-center')} />;
  }

  return <MandateWizard initialName={initialName} onBrief={handleBrief} />;
}
