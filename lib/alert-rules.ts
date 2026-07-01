import { createServiceClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface AlertRule {
  id: string;
  org_id: string;
  name: string;
  trigger_entity: string;
  trigger_field: string;
  operator: "lt" | "gt" | "eq" | "changed" | "contains";
  threshold_value?: string;
  channel: {
    slack?: boolean;
    email?: boolean;
    in_app?: boolean;
  };
  escalation: {
    hours?: number;
    notify_role?: string;
  };
  active: boolean;
  created_by?: string;
  created_at: string;
}

export interface AlertEvent {
  id: string;
  rule_id: string;
  org_id: string;
  entity_type: string;
  entity_id?: string;
  payload?: Record<string, unknown>;
  acknowledged_at?: string;
  acknowledged_by?: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// createAlertRule
// ---------------------------------------------------------------------------

export async function createAlertRule(
  args: Omit<AlertRule, "id" | "created_at">,
): Promise<AlertRule> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("alert_rules")
    .insert({
      org_id: args.org_id,
      name: args.name,
      trigger_entity: args.trigger_entity,
      trigger_field: args.trigger_field,
      operator: args.operator,
      threshold_value: args.threshold_value ?? null,
      channel: args.channel,
      escalation: args.escalation,
      active: args.active,
      created_by: args.created_by ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`createAlertRule: ${error.message}`);
  return data as AlertRule;
}

// ---------------------------------------------------------------------------
// listAlertRules
// ---------------------------------------------------------------------------

export async function listAlertRules(orgId: string): Promise<AlertRule[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("alert_rules")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listAlertRules: ${error.message}`);
  return (data ?? []) as AlertRule[];
}

// ---------------------------------------------------------------------------
// acknowledgeAlert
// ---------------------------------------------------------------------------

export async function acknowledgeAlert(
  eventId: string,
  userId: string,
): Promise<void> {
  const db = createServiceClient();
  const { error } = await db
    .from("alert_events")
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: userId,
    })
    .eq("id", eventId);

  if (error) throw new Error(`acknowledgeAlert: ${error.message}`);
}

// ---------------------------------------------------------------------------
// listUnacknowledgedAlerts
// ---------------------------------------------------------------------------

export async function listUnacknowledgedAlerts(
  orgId: string,
): Promise<AlertEvent[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("alert_events")
    .select("*")
    .eq("org_id", orgId)
    .is("acknowledged_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listUnacknowledgedAlerts: ${error.message}`);
  return (data ?? []) as AlertEvent[];
}

// ---------------------------------------------------------------------------
// evaluateAlertRules  (stub — real evaluation wired in cron)
// ---------------------------------------------------------------------------

export async function evaluateAlertRules(_orgId: string): Promise<number> {
  return 0;
}

// ---------------------------------------------------------------------------
// fireAlert
// ---------------------------------------------------------------------------

export async function fireAlert(
  ruleId: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<AlertEvent> {
  const db = createServiceClient();

  // Resolve org_id from the rule
  const { data: rule, error: ruleErr } = await db
    .from("alert_rules")
    .select("org_id")
    .eq("id", ruleId)
    .single();

  if (ruleErr) throw new Error(`fireAlert: rule lookup: ${ruleErr.message}`);

  const { data, error } = await db
    .from("alert_events")
    .insert({
      rule_id: ruleId,
      org_id: (rule as { org_id: string }).org_id,
      entity_type: entityType,
      entity_id: entityId,
      payload: payload as import("@/lib/supabase/database.types").Json,
    })
    .select()
    .single();

  if (error) throw new Error(`fireAlert: ${error.message}`);
  return data as AlertEvent;
}
