-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
-- P2-4: Audit logging triggers for deals, tasks, organizations, credit_ledger.
-- Writes INSERT/UPDATE/DELETE events to audit_log with before/after snapshots.
-- SECURITY DEFINER so the write succeeds regardless of caller RLS context.

CREATE OR REPLACE FUNCTION public.audit_table_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_organization_id uuid;
  v_entity_id uuid;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_organization_id := NEW.organization_id;
    v_entity_id       := NEW.id;
    v_before          := NULL;
    v_after           := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_organization_id := NEW.organization_id;
    v_entity_id       := NEW.id;
    v_before          := to_jsonb(OLD);
    v_after           := to_jsonb(NEW);
  ELSE -- DELETE
    v_organization_id := OLD.organization_id;
    v_entity_id       := OLD.id;
    v_before          := to_jsonb(OLD);
    v_after           := NULL;
  END IF;

  INSERT INTO public.audit_log (
    organization_id,
    principal_id,
    action,
    entity_type,
    entity_id,
    before_state,
    after_state
  ) VALUES (
    v_organization_id,
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    v_entity_id,
    v_before,
    v_after
  );

  RETURN NULL;
END;
$$;

-- deals
DROP TRIGGER IF EXISTS audit_deals ON public.deals;
CREATE TRIGGER audit_deals
  AFTER INSERT OR UPDATE OR DELETE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();

-- tasks
DROP TRIGGER IF EXISTS audit_tasks ON public.tasks;
CREATE TRIGGER audit_tasks
  AFTER INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();

-- organizations
DROP TRIGGER IF EXISTS audit_organizations ON public.organizations;
CREATE TRIGGER audit_organizations
  AFTER INSERT OR UPDATE OR DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();

-- credit_ledger (insert-only by design, but cover all ops for completeness)
DROP TRIGGER IF EXISTS audit_credit_ledger ON public.credit_ledger;
CREATE TRIGGER audit_credit_ledger
  AFTER INSERT OR UPDATE OR DELETE ON public.credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();;
