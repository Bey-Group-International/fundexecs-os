/**
 * LP Room — public exports.
 *
 * Backend (Claude) imports prop contracts and fixtures from here when wiring
 * the room to real Supabase data.
 */
export { LpRoom } from './LpRoom';
export type { LpRoomProps } from './LpRoom';

export { FundOverviewCard } from './FundOverviewCard';
export type { FundOverviewCardProps } from './FundOverviewCard';

export { DocumentVaultList } from './DocumentVaultList';
export type { DocumentVaultListProps } from './DocumentVaultList';

export { UpdateFeed } from './UpdateFeed';
export type { UpdateFeedProps } from './UpdateFeed';

export { CommitmentTracker } from './CommitmentTracker';
export type { CommitmentTrackerProps } from './CommitmentTracker';

export { DistributionsFeed } from './DistributionsFeed';
export type { DistributionsFeedProps } from './DistributionsFeed';

export { CapitalAccountCard } from './CapitalAccountCard';
export type { CapitalAccountCardProps } from './CapitalAccountCard';

export { LpQAChat } from './LpQAChat';
export type { LpQAChatProps } from './LpQAChat';

export type {
  CapitalAccountSummaryData,
  CommitmentScheduleRow,
  CommitmentSnapshot,
  DistributionItem,
  DistributionKind,
  DistributionStatus,
  FundOverview,
  FundStatus,
  LpAnswer,
  LpDocument,
  LpDocumentAccess,
  LpDocumentKind,
  LpQuestion,
  LpQuestionDraft,
  LpQuestionStatus,
  LpRoomData,
  LpUpdate,
  LpUpdateAttachment,
  LpUpdateLifecycle
} from './types';

export {
  FIXTURE_CAPITAL_ACCOUNT,
  FIXTURE_COMMITMENTS,
  FIXTURE_DISTRIBUTIONS,
  FIXTURE_DOCUMENTS,
  FIXTURE_FUND,
  FIXTURE_LP_ROOM,
  FIXTURE_QUESTIONS,
  FIXTURE_UPDATES
} from './fixtures';
