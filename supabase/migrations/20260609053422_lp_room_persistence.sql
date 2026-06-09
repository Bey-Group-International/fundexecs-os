-- =====================================================================
-- LP Room persistence: fund-room documents, updates, and Q&A.
--
-- Additive + idempotent. Public tables are org-scoped with RLS.
-- Authenticated org members can read the room and submit questions; owners
-- and admins manage room content. Document bytes live in private Storage and
-- are opened through short-lived signed URLs from server actions.
-- =====================================================================

-- 1. Private document storage -----------------------------------------

insert into storage.buckets (id, name, public)
values ('lp-room-documents', 'lp-room-documents', false)
on conflict (id) do nothing;

update storage.buckets
set public = false
where id = 'lp-room-documents';

-- 2. Tables ------------------------------------------------------------

create table if not exists public.lp_room_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  kind text not null default 'other',
  storage_bucket text not null default 'lp-room-documents',
  storage_path text not null,
  mime_type text,
  size_bytes bigint not null default 0,
  signed boolean not null default false,
  access_level text not null default 'prospect',
  uploaded_by uuid references public.profiles (id) on delete set null,
  uploaded_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.lp_room_updates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  body text not null,
  lifecycle text not null default 'reporting',
  author_id uuid references public.profiles (id) on delete set null,
  author_name text not null default 'Eleanor',
  author_role text not null default 'Head of Investor Relations',
  posted_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.lp_room_update_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  update_id uuid not null references public.lp_room_updates (id) on delete cascade,
  document_id uuid references public.lp_room_documents (id) on delete set null,
  name text not null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.lp_room_questions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  asked_by uuid not null references public.profiles (id) on delete cascade,
  asker_name text not null,
  body text not null,
  status text not null default 'open',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.lp_room_answers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  question_id uuid not null references public.lp_room_questions (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_name text not null default 'Eleanor',
  author_role text,
  body text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.lp_room_answer_citations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  answer_id uuid not null references public.lp_room_answers (id) on delete cascade,
  document_id uuid references public.lp_room_documents (id) on delete set null,
  label text not null,
  created_at timestamp with time zone not null default now()
);

create index if not exists lp_room_documents_org_uploaded_idx
  on public.lp_room_documents (org_id, uploaded_at desc);
create index if not exists lp_room_updates_org_posted_idx
  on public.lp_room_updates (org_id, posted_at desc);
create index if not exists lp_room_update_attachments_update_idx
  on public.lp_room_update_attachments (update_id);
create index if not exists lp_room_questions_org_created_idx
  on public.lp_room_questions (org_id, created_at desc);
create index if not exists lp_room_answers_question_created_idx
  on public.lp_room_answers (question_id, created_at asc);
create index if not exists lp_room_answer_citations_answer_idx
  on public.lp_room_answer_citations (answer_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lp_room_documents'::regclass
      and conname = 'lp_room_documents_kind_check'
  ) then
    alter table public.lp_room_documents
      add constraint lp_room_documents_kind_check
      check (kind in (
        'lpa',
        'side-letter',
        'subscription',
        'report',
        'k1',
        'capital-call',
        'distribution-notice',
        'memo',
        'other'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lp_room_documents'::regclass
      and conname = 'lp_room_documents_access_level_check'
  ) then
    alter table public.lp_room_documents
      add constraint lp_room_documents_access_level_check
      check (access_level in ('committed', 'prospect', 'admin-only'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lp_room_documents'::regclass
      and conname = 'lp_room_documents_size_bytes_check'
  ) then
    alter table public.lp_room_documents
      add constraint lp_room_documents_size_bytes_check
      check (size_bytes >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lp_room_updates'::regclass
      and conname = 'lp_room_updates_lifecycle_check'
  ) then
    alter table public.lp_room_updates
      add constraint lp_room_updates_lifecycle_check
      check (lifecycle in (
        'mandate',
        'source-raise',
        'analyze-package',
        'communicate-close',
        'reporting'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lp_room_questions'::regclass
      and conname = 'lp_room_questions_status_check'
  ) then
    alter table public.lp_room_questions
      add constraint lp_room_questions_status_check
      check (status in ('open', 'answered', 'archived'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lp_room_documents'::regclass
      and conname = 'lp_room_documents_name_not_blank'
  ) then
    alter table public.lp_room_documents
      add constraint lp_room_documents_name_not_blank
      check (length(btrim(name)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lp_room_questions'::regclass
      and conname = 'lp_room_questions_body_not_blank'
  ) then
    alter table public.lp_room_questions
      add constraint lp_room_questions_body_not_blank
      check (length(btrim(body)) > 0);
  end if;
end$$;

do $$
declare
  _table regclass;
begin
  foreach _table in array array[
    'public.lp_room_documents'::regclass,
    'public.lp_room_updates'::regclass,
    'public.lp_room_questions'::regclass,
    'public.lp_room_answers'::regclass
  ]
  loop
    if not exists (
      select 1
      from pg_trigger
      where tgname = 'set_updated_at'
        and tgrelid = _table
    ) then
      execute format(
        'create trigger set_updated_at before update on %s for each row execute function public.set_updated_at()',
        _table
      );
    end if;
  end loop;
end$$;

-- 3. RLS + grants ------------------------------------------------------

alter table public.lp_room_documents enable row level security;
alter table public.lp_room_updates enable row level security;
alter table public.lp_room_update_attachments enable row level security;
alter table public.lp_room_questions enable row level security;
alter table public.lp_room_answers enable row level security;
alter table public.lp_room_answer_citations enable row level security;

revoke all on table public.lp_room_documents from anon, authenticated;
revoke all on table public.lp_room_updates from anon, authenticated;
revoke all on table public.lp_room_update_attachments from anon, authenticated;
revoke all on table public.lp_room_questions from anon, authenticated;
revoke all on table public.lp_room_answers from anon, authenticated;
revoke all on table public.lp_room_answer_citations from anon, authenticated;

grant select on table public.lp_room_documents to authenticated;
grant select on table public.lp_room_updates to authenticated;
grant select on table public.lp_room_update_attachments to authenticated;
grant select, insert on table public.lp_room_questions to authenticated;
grant select on table public.lp_room_answers to authenticated;
grant select on table public.lp_room_answer_citations to authenticated;

grant select, insert, update, delete on table public.lp_room_documents to service_role;
grant select, insert, update, delete on table public.lp_room_updates to service_role;
grant select, insert, update, delete on table public.lp_room_update_attachments to service_role;
grant select, insert, update, delete on table public.lp_room_questions to service_role;
grant select, insert, update, delete on table public.lp_room_answers to service_role;
grant select, insert, update, delete on table public.lp_room_answer_citations to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lp_room_documents'
      and policyname = 'members read lp_room_documents'
  ) then
    create policy "members read lp_room_documents" on public.lp_room_documents
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lp_room_updates'
      and policyname = 'members read lp_room_updates'
  ) then
    create policy "members read lp_room_updates" on public.lp_room_updates
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lp_room_update_attachments'
      and policyname = 'members read lp_room_update_attachments'
  ) then
    create policy "members read lp_room_update_attachments" on public.lp_room_update_attachments
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lp_room_questions'
      and policyname = 'members read lp_room_questions'
  ) then
    create policy "members read lp_room_questions" on public.lp_room_questions
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lp_room_answers'
      and policyname = 'members read lp_room_answers'
  ) then
    create policy "members read lp_room_answers" on public.lp_room_answers
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lp_room_answer_citations'
      and policyname = 'members read lp_room_answer_citations'
  ) then
    create policy "members read lp_room_answer_citations" on public.lp_room_answer_citations
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lp_room_questions'
      and policyname = 'members ask lp_room_questions'
  ) then
    create policy "members ask lp_room_questions" on public.lp_room_questions
      for insert to authenticated
      with check (
        asked_by = (select auth.uid())
        and private.is_org_member(org_id)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lp_room_questions'
      and policyname = 'admins update lp_room_questions'
  ) then
    create policy "admins update lp_room_questions" on public.lp_room_questions
      for update to authenticated
      using (private.is_org_admin(org_id))
      with check (private.is_org_admin(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lp_room_documents'
      and policyname = 'service_role manage lp_room_documents'
  ) then
    create policy "service_role manage lp_room_documents" on public.lp_room_documents
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lp_room_updates'
      and policyname = 'service_role manage lp_room_updates'
  ) then
    create policy "service_role manage lp_room_updates" on public.lp_room_updates
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lp_room_update_attachments'
      and policyname = 'service_role manage lp_room_update_attachments'
  ) then
    create policy "service_role manage lp_room_update_attachments"
      on public.lp_room_update_attachments
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lp_room_questions'
      and policyname = 'service_role manage lp_room_questions'
  ) then
    create policy "service_role manage lp_room_questions" on public.lp_room_questions
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lp_room_answers'
      and policyname = 'service_role manage lp_room_answers'
  ) then
    create policy "service_role manage lp_room_answers" on public.lp_room_answers
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lp_room_answer_citations'
      and policyname = 'service_role manage lp_room_answer_citations'
  ) then
    create policy "service_role manage lp_room_answer_citations"
      on public.lp_room_answer_citations
      for all to service_role
      using (true)
      with check (true);
  end if;
end$$;

-- 4. Storage policies -------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'lp_room_documents members read'
  ) then
    create policy "lp_room_documents members read" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'lp-room-documents'
        and case
          when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then private.is_org_member(((storage.foldername(name))[1])::uuid)
          else false
        end
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'lp_room_documents service upload'
  ) then
    create policy "lp_room_documents service upload" on storage.objects
      for insert to service_role
      with check (bucket_id = 'lp-room-documents');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'lp_room_documents service update'
  ) then
    create policy "lp_room_documents service update" on storage.objects
      for update to service_role
      using (bucket_id = 'lp-room-documents')
      with check (bucket_id = 'lp-room-documents');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'lp_room_documents service delete'
  ) then
    create policy "lp_room_documents service delete" on storage.objects
      for delete to service_role
      using (bucket_id = 'lp-room-documents');
  end if;
end$$;
