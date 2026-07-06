-- Fix: audit_table_change() raised
--   record "new" has no field "organization_id"
-- on every organizations INSERT/UPDATE/DELETE, because it referenced
-- NEW.organization_id unconditionally while the `organizations` table has no
-- such column — the organization row's own `id` IS the organization id.
-- The audit_organizations trigger therefore aborted every write to
-- organizations, which blocked Build > Profile saves (UPDATE organizations …).
--
-- Redefine the function to read the org id from a jsonb snapshot (so a table
-- that lacks the column can never raise a missing-field error) and to treat
-- the organizations table's own id as the organization id. Behavior is
-- unchanged for deals / tasks / credit_ledger, which carry organization_id.

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
  v_row jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_before := to_jsonb(OLD);
    v_after  := NULL;
    v_row    := v_before;
  ELSIF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD);
    v_after  := to_jsonb(NEW);
    v_row    := v_after;
  ELSE -- INSERT
    v_before := NULL;
    v_after  := to_jsonb(NEW);
    v_row    := v_after;
  END IF;

  v_entity_id := (v_row ->> 'id')::uuid;

  IF TG_TABLE_NAME = 'organizations' THEN
    -- The organizations row's own id is the organization id.
    v_organization_id := (v_row ->> 'id')::uuid;
  ELSE
    v_organization_id := (v_row ->> 'organization_id')::uuid;
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
