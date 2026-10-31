-- 20261031120000_data_room_document_signatures.sql
--
-- Per-file signatures in a data room (e.g. an NDA uploaded as a file).
--
-- 1. `data_room_documents.require_signature`: a room's publish manifest row can
--    require a reader to sign before that one file opens. Other files stay open.
-- 2. `data_room_document_signatures`: one row per (link, file, reader email). It
--    keeps the SHA-256 of the exact file signed, so replacing the file later
--    never changes what an earlier signer agreed to. Written by the server
--    only (service role); the signer's email comes from the link's email gate.

alter table public.data_room_documents
  add column if not exists require_signature boolean not null default false;

create table if not exists public.data_room_document_signatures (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  room_id         uuid not null references public.data_rooms (id) on delete cascade,
  document_id     uuid not null references public.documents (id) on delete cascade,
  share_id        uuid not null references public.data_room_shares (id) on delete cascade,
  signer_name     text not null,
  signer_email    text not null,
  signed_at       timestamptz not null default now(),
  ip_hint         text,
  file_name       text not null,
  file_sha256     text not null,
  agreed          boolean not null default true,
  copy_sent_at    timestamptz
);

create unique index if not exists data_room_document_signatures_once
  on public.data_room_document_signatures (share_id, document_id, lower(signer_email));
create index if not exists data_room_document_signatures_doc_idx
  on public.data_room_document_signatures (room_id, document_id, signed_at desc);
create index if not exists data_room_document_signatures_org_idx
  on public.data_room_document_signatures (organization_id);

alter table public.data_room_document_signatures enable row level security;

drop policy if exists data_room_document_signatures_select on public.data_room_document_signatures;
create policy data_room_document_signatures_select on public.data_room_document_signatures
  for select using (organization_id in (select public.current_principal_org_ids()));

grant select on public.data_room_document_signatures to authenticated;
grant select, insert, update, delete on public.data_room_document_signatures to service_role;
