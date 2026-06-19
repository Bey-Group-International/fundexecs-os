-- Step 1 of 2: extend the agent_key enum with 9 new values.
-- Must be committed before the INSERT in 0028 can use them (PG restriction).
ALTER TYPE agent_key ADD VALUE IF NOT EXISTS 'executive_advisor';
ALTER TYPE agent_key ADD VALUE IF NOT EXISTS 'capital_raiser';
ALTER TYPE agent_key ADD VALUE IF NOT EXISTS 'capital_connector';
ALTER TYPE agent_key ADD VALUE IF NOT EXISTS 'deal_sourcer';
ALTER TYPE agent_key ADD VALUE IF NOT EXISTS 'rainmaker';
ALTER TYPE agent_key ADD VALUE IF NOT EXISTS 'lead_generator';
ALTER TYPE agent_key ADD VALUE IF NOT EXISTS 'pr_director';
ALTER TYPE agent_key ADD VALUE IF NOT EXISTS 'seo_disruptor';
ALTER TYPE agent_key ADD VALUE IF NOT EXISTS 'curator';
