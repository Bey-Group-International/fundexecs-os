-- Network optimizations: per-user outreach profile + notes hash for AI cost reduction.

-- Per-user intro blurb for outreach drafts (stored on principals).
alter table public.principals
  add column if not exists intro_blurb text,
  add column if not exists intro_blurb_updated_at timestamptz;

-- notes_hash: skip re-inference when notes haven't changed.
alter table public.network_contacts
  add column if not exists notes_hash text;

-- Full-text search index for faster NL network search.
alter table public.network_contacts
  add column if not exists fts tsvector
    generated always as (
      to_tsvector('english',
        coalesce(first_name, '') || ' ' ||
        coalesce(last_name, '') || ' ' ||
        coalesce(title, '') || ' ' ||
        coalesce(company, '') || ' ' ||
        coalesce(location, '') || ' ' ||
        coalesce(notes, '')
      )
    ) stored;

create index if not exists network_contacts_fts_idx
  on network_contacts using gin(fts);

create index if not exists network_contacts_org_strength_idx
  on network_contacts(organization_id, strength_score desc)
  where strength_score is not null;
