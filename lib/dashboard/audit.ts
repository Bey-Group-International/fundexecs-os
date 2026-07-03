import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

export async function writeDashboardAudit({
  organizationId,
  principalId,
  action,
  entityType,
  entityId,
  beforeState,
  afterState,
}: {
  organizationId: string;
  principalId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeState?: Json;
  afterState?: Json;
}) {
  if (!hasSupabaseServiceEnv()) return;
  const supabase = createServiceClient();
  await supabase.from("audit_log").insert({
    organization_id: organizationId,
    principal_id: principalId,
    action,
    entity_type: entityType,
    entity_id: entityId ?? null,
    before_state: beforeState ?? null,
    after_state: afterState ?? null,
  });
}
