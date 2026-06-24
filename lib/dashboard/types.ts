import type {
  Approval,
  Automation,
  Deal,
  DispatchLog,
  Fund,
  Investor,
  Task,
} from "@/lib/supabase/database.types";
import type { ExecutiveCharacter } from "@/components/characters/characterConfig";

export type DashboardWorkspaceKey =
  | "command"
  | "capital"
  | "deals"
  | "fund-room"
  | "investor-relations"
  | "automation"
  | "marketing";

export type DashboardMetric = {
  label: string;
  value: string;
  detail: string;
  tone?: "good" | "warn" | "muted";
};

export type WorkspaceAction = {
  label: string;
  href: string;
};

export type WorkspaceConfig = {
  key: DashboardWorkspaceKey;
  title: string;
  eyebrow: string;
  description: string;
  href: string;
  primaryAction: WorkspaceAction;
  characterId: string;
  recommendation: string;
};

export type DashboardActivity = {
  id: string;
  title: string;
  detail: string;
  createdAt: string;
};

export type DashboardData = {
  metrics: DashboardMetric[];
  investors: Investor[];
  deals: Deal[];
  funds: Fund[];
  tasks: Task[];
  approvals: Approval[];
  automations: Automation[];
  activities: DashboardActivity[];
  dispatches: DispatchLog[];
};

export type WorkspaceViewModel = WorkspaceConfig & {
  character: ExecutiveCharacter;
  metrics: DashboardMetric[];
  tasks: Task[];
  activities: DashboardActivity[];
};
