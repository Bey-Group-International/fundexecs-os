// lib/earn/browser-operator/index.ts
//
// EPIC #2 — Earn Controlled Browser-Operator layer. Public surface.
//
// A permission-first, approval-gated, fully-audited skeleton for letting Earn
// operate a browser on the operator's behalf. The real browser driver and live
// extraction are deliberate seams (see the /extract route); this layer owns the
// session model, state machine, consent gates, review-before-save, and audit.

export * from "./types";
export {
  canTransition,
  nextOnEvent,
  legalNextStatuses,
  type SessionEvent,
} from "./session-machine";
export { buildScopeCard, scopeRequiresUserAuth } from "./task-plan";
export {
  browserActionTier,
  browserActionTierLabel,
  needsExternalActionApproval,
  evaluateBrowserConsent,
  type BrowserOperationIntent,
  type BrowserConsentDecision,
} from "./consent-gates";
export {
  SOURCE_POLICIES,
  policyForSource,
  isActionProhibitedForSource,
  authGatedSources,
  type SourcePolicy,
} from "./source-policy";
export {
  LOW_CONFIDENCE_THRESHOLD,
  isBlocking,
  blockingLowConfidence,
  buildReviewRecord,
  reviewSummary,
  applyDecision,
  approvedFields,
  canSubmitForSave,
  type ReviewDecision,
  type ReviewField,
  type ReviewSummary,
  type ReviewRecord,
} from "./review-queue";
export {
  describeAuditEvent,
  defaultAuditDescription,
  type EarnBrowserAuditEvent,
} from "./audit-log";
