-- 0021_marketplace_public_read.sql
-- Cross-org public board: let any authenticated user read marketplace
-- listings that have been explicitly marked public. This is purely additive —
-- the existing org-scoped policies (marketplace_select / marketplace_write)
-- are left untouched. The policy grants SELECT only, and only for rows where
-- is_public = true, so private listings are never exposed.

create policy marketplace_listings_public_read on public.marketplace_listings
  for select to authenticated using (is_public = true);
