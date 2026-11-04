// lib/signing/wizard.ts
//
// The three steps every signature goes through, and where an envelope is among them:
// the maker places the blocks and sends, the reader fills and signs, the maker
// countersigns. Pure, so the owner's page, the reader's page and the emails agree.

export const WIZARD_STEPS = [
  { n: 1, label: "Place blocks", who: "You" },
  { n: 2, label: "Reader signs", who: "Reader" },
  { n: 3, label: "Countersign", who: "You" },
] as const;

/** 1-3: the step in progress; 4: all three done; null: voided, declined or expired (no wizard). */
export type WizardStep = 1 | 2 | 3 | 4;

export function wizardStep(status: string): WizardStep | null {
  switch (status) {
    case "draft":
      return 1;
    case "sent":
      return 2;
    case "partially_signed":
      return 3;
    case "completed":
      return 4;
    default:
      return null;
  }
}
