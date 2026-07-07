// Single source of truth for the mobile app shell's navigation: the bottom
// tab bar, the quick-action drawer, and the "More" menu. Every destination
// resolves to a real, existing route so the app never dead-ends.
import type { ComponentType, SVGProps } from "react";
import {
  HomeIcon,
  EarnIcon,
  DealsIcon,
  NetworkIcon,
  MoreIcon,
  SparkIcon,
  DocIcon,
  ContactIcon,
  TaskIcon,
  ShieldIcon,
  DataRoomIcon,
  UploadIcon,
  UsersIcon,
  CapitalIcon,
  ReportIcon,
  SettingsIcon,
  WalletIcon,
  StoreIcon,
  HelpIcon,
  CalendarIcon,
  BellIcon,
  UserIcon,
} from "./icons";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export interface TabItem {
  key: string;
  label: string;
  href: string;
  icon: Icon;
  /** Extra pathname prefixes that should light this tab as active. */
  match?: string[];
}

// Four primary tabs + a "More" trigger. The quick-action FAB sits in the
// notch between Earn and Deals (rendered separately).
export const TABS: TabItem[] = [
  { key: "home", label: "Home", href: "/home", icon: HomeIcon, match: ["/home", "/dashboard", "/command-center"] },
  { key: "earn", label: "Earn", href: "/earn", icon: EarnIcon, match: ["/earn", "/workspace", "/sessions", "/session", "/automations"] },
  { key: "deals", label: "Deals", href: "/deals/feed", icon: DealsIcon, match: ["/deals", "/run", "/deal/", "/portfolio"] },
  { key: "network", label: "Network", href: "/network", icon: NetworkIcon, match: ["/network", "/source", "/relationship", "/prospecting", "/investor"] },
  { key: "more", label: "More", href: "#more", icon: MoreIcon },
];

export interface QuickAction {
  key: string;
  label: string;
  hint: string;
  href: string;
  icon: Icon;
  /** Approval-sensitive / outward-facing action — flagged in the drawer. */
  gated?: boolean;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { key: "ask-earn", label: "Ask Earn", hint: "Delegate a task to your copilot", href: "/earn", icon: SparkIcon },
  { key: "add-deal", label: "Add a deal", hint: "Start a new opportunity", href: "/deals/feed", icon: DealsIcon },
  { key: "add-contact", label: "Add a contact", hint: "Investor, LP, advisor or operator", href: "/network", icon: ContactIcon },
  { key: "upload-doc", label: "Upload a document", hint: "Into your materials & data room", href: "/build/data_room", icon: UploadIcon },
  { key: "create-task", label: "Create a task", hint: "Route work to an executive agent", href: "/earn", icon: TaskIcon },
  { key: "start-diligence", label: "Start diligence", hint: "Open the diligence workspace", href: "/run/diligence", icon: ShieldIcon },
  { key: "investor-update", label: "Investor update", hint: "Generate an LP-facing report", href: "/execute/reporting", icon: ReportIcon, gated: true },
  { key: "data-room", label: "Open a data room", hint: "Materials, files & sharing", href: "/build/data_room", icon: DataRoomIcon },
  { key: "request-capital", label: "Request capital support", hint: "Debt, hybrid & capital partners", href: "/source/debt", icon: CapitalIcon },
  { key: "invite", label: "Invite a teammate", hint: "Add your deal team", href: "/settings/account", icon: UsersIcon },
];

export interface MoreItem {
  key: string;
  label: string;
  href: string;
  icon: Icon;
  desc?: string;
}

export interface MoreGroup {
  heading: string;
  items: MoreItem[];
}

export const MORE_GROUPS: MoreGroup[] = [
  {
    heading: "Workspace",
    items: [
      { key: "approvals", label: "Approvals", href: "/approvals", icon: ShieldIcon, desc: "Swipe to decide sign-offs" },
      { key: "command-center", label: "Command Center", href: "/command-center", icon: HomeIcon, desc: "The AI executive floor" },
      { key: "workflows", label: "Workflows", href: "/automations", icon: TaskIcon, desc: "Active & automated work" },
      { key: "activity", label: "Activity", href: "/activity", icon: SparkIcon, desc: "What agents have been doing" },
      { key: "meetings", label: "Meetings", href: "/meetings", icon: CalendarIcon, desc: "Calls, notes & scheduling" },
    ],
  },
  {
    heading: "Relationships & deals",
    items: [
      { key: "marketplace", label: "Marketplace", href: "/marketplace/browse", icon: StoreIcon, desc: "Opportunities & listings" },
      { key: "data-room", label: "Materials & Data Room", href: "/build/data_room", icon: DataRoomIcon, desc: "Documents & sharing" },
      { key: "reports", label: "Reports", href: "/reports", icon: ReportIcon, desc: "Fund & portfolio reporting" },
    ],
  },
  {
    heading: "Account",
    items: [
      { key: "notifications", label: "Notifications & Inbox", href: "/inbox", icon: BellIcon, desc: "Approvals, replies & alerts" },
      { key: "profile", label: "Profile", href: "/settings/account", icon: UserIcon, desc: "Your account details" },
      { key: "wallet", label: "Wallet & Billing", href: "/wallet", icon: WalletIcon, desc: "Credits & subscription" },
      { key: "settings", label: "Settings", href: "/settings", icon: SettingsIcon, desc: "Preferences & integrations" },
      { key: "help", label: "Help & Support", href: "/settings", icon: HelpIcon, desc: "Guides & assistance" },
    ],
  },
];
