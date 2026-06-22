// lib/lp-onboarding.ts
// LP Onboarding Portal logic — Repool clone.
// Tracks one LP through: accreditation → KYC → subscription docs → commitment → capital.

export type OnboardingStatus =
  | "pending"
  | "accreditation"
  | "subscription"
  | "committed"
  | "complete"
  | "expired";

export interface OnboardingStep {
  key: OnboardingStatus;
  label: string;
  description: string;
  completed: boolean;
  current: boolean;
}

export function buildOnboardingSteps(currentStatus: OnboardingStatus): OnboardingStep[] {
  const ORDER: OnboardingStatus[] = [
    "pending",
    "accreditation",
    "subscription",
    "committed",
    "complete",
  ];
  const currentIndex = ORDER.indexOf(currentStatus);

  return ORDER.filter((s) => s !== "expired").map((status, i) => ({
    key: status,
    label: STEP_LABELS[status],
    description: STEP_DESCRIPTIONS[status],
    completed: i < currentIndex,
    current: i === currentIndex,
  }));
}

const STEP_LABELS: Record<OnboardingStatus, string> = {
  pending: "Invitation",
  accreditation: "Accreditation",
  subscription: "Subscription Agreement",
  committed: "Capital Commitment",
  complete: "Complete",
  expired: "Expired",
};

const STEP_DESCRIPTIONS: Record<OnboardingStatus, string> = {
  pending: "LP invitation sent and portal link active",
  accreditation: "Verify accreditation status and investor type",
  subscription: "Review and sign the subscription agreement",
  committed: "Confirm capital commitment and wire instructions",
  complete: "LP onboarding complete — welcome to the fund",
  expired: "This onboarding link has expired",
};

export function onboardingProgressPct(status: OnboardingStatus): number {
  const map: Record<OnboardingStatus, number> = {
    pending: 10,
    accreditation: 30,
    subscription: 60,
    committed: 85,
    complete: 100,
    expired: 0,
  };
  return map[status] ?? 0;
}
