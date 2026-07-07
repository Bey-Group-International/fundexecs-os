// Mobile app shell — the phone/app-native layer for FundExecs OS. Every export
// here renders only inside `md:hidden` shells (or dedicated app routes), so the
// desktop and web experiences are entirely unaffected. See docs/MOBILE_APP.md.
export { AppShellMobile } from "./AppShellMobile";
export { MobileBottomNav } from "./MobileBottomNav";
export { MobileQuickAction } from "./MobileQuickAction";
export { MobileMoreMenu } from "./MobileMoreMenu";
export { MobileSheet } from "./MobileSheet";
export { MobileInstallPrompt } from "./MobileInstallPrompt";
export { ServiceWorkerRegister } from "./ServiceWorkerRegister";
export { MobileCommandCenter, type CommandCenterData } from "./MobileCommandCenter";
export { MobileEarnHome } from "./MobileEarnHome";
export { MobileEarnPanel } from "./MobileEarnPanel";
export { MobileSectionHeader } from "./MobileSectionHeader";
export { MobileDealCard, type MobileDeal } from "./MobileDealCard";
export { MobileContactCard, type MobileContact } from "./MobileContactCard";
export { MobileWorkflowCard, type MobileWorkflow } from "./MobileWorkflowCard";
export { MobileApprovalCard, type MobileApproval } from "./MobileApprovalCard";
export { MobileApprovalsFlow, type ApprovalItem } from "./MobileApprovalsFlow";
export { MobileStatTile, MobileNextAction, type CommandStat } from "./MobileCommandCard";
export { SwipeableCard, type SwipeAction } from "./SwipeableCard";
export { PullToRefresh } from "./PullToRefresh";
export { MobileDealActionBar } from "./MobileDealActionBar";
export { MobileContactActionBar } from "./MobileContactActionBar";
export { useHideOnScroll } from "./useHideOnScroll";
export { useOnline } from "./useOnline";
export { OfflineBanner } from "./OfflineBanner";
export { MobileToastProvider, useMobileToast } from "./MobileToast";
export { SessionGuard } from "./SessionGuard";
export { MobileSyncRegistrar, APPROVAL_DECISION_TYPE, type ApprovalDecisionPayload } from "./MobileSyncRegistrar";
export { enqueue, registerExecutor, flush, getPending, usePendingSync, type QueueItem } from "./offlineQueue";
export { haptic } from "./haptics";
export * from "./nav-config";
