/**
 * Profile barrel — the Source-of-Truth surface components consumed by
 * `app/profile/page.tsx`, wired to the member-type-aware `FundProfile` payload
 * from `lib/queries/fund-profile`.
 */
export { ProfileHero } from './ProfileHero';
export type { ProfileHeroProps } from './ProfileHero';

export { ProfileSections } from './ProfileSections';
export type { ProfileSectionsProps } from './ProfileSections';

export { ProfileGapsCard } from './ProfileGapsCard';
export type { ProfileGapsCardProps } from './ProfileGapsCard';

export { ProfileRailSummary, ProfileRailSummaryEmpty } from './ProfileRailSummary';
export type { ProfileRailSummaryProps } from './ProfileRailSummary';

export { ProfileActionButton } from './ProfileActionButton';
export type { ProfileActionButtonProps } from './ProfileActionButton';
