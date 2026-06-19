-- Rename the Associate agent display name to Earn.
-- The DB key 'associate' is preserved so no FK or enum changes are needed.
UPDATE public.ai_agents SET name = 'Earn' WHERE key = 'associate';
