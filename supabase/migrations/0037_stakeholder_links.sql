-- 0037_stakeholder_links.sql
-- Link cap-table stakeholders to existing identities — a stakeholder may be the
-- same person as a team member (principal) or the same party as an investor/LP,
-- so the firm cap table and people/LP records share identities. Optional links;
-- clearing the source record sets the link to null. Existing stakeholders RLS
-- (member-read / writer-write) already covers these columns — no new policy.

alter table public.stakeholders
  add column if not exists principal_id uuid references public.principals (id) on delete set null;

alter table public.stakeholders
  add column if not exists investor_id uuid references public.investors (id) on delete set null;
