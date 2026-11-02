-- 20261102180000_signature_blocks.sql
--
-- Click-to-place signature blocks on the real document.
--
-- The owner opens the document, places blocks where they belong, sends it; the
-- recipient fills and signs; the owner countersigns. The envelope tables already
-- hold positioned fields (page, x/y/width/height as percentages of the page); this
-- adds the block types the product offers, a place to keep the document itself,
-- and the owner's own signing turn.

-- 1. The block types: name, signature, date and time, company, title, address.
--    The earlier types stay valid so existing envelopes still open.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.envelope_fields'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%field_type%'
  loop
    execute format('alter table public.envelope_fields drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.envelope_fields
  add constraint envelope_fields_field_type_check
  check (field_type in ('signature','initials','text','date','checkbox',
                        'name','datetime','company','title','address'));

-- A value the owner fills in beforehand, and whether the signer may change it.
alter table public.envelope_fields
  add column if not exists prefill text check (prefill is null or char_length(prefill) <= 2000),
  add column if not exists locked boolean not null default false;

-- 2. The document being signed, as a PDF in the documents bucket, with its fingerprint.
alter table public.envelopes
  add column if not exists pdf_storage_key text,
  add column if not exists document_sha256 text
    check (document_sha256 is null or document_sha256 ~ '^[0-9a-f]{64}$');

-- 3. Who is signing: the recipient, or the account owner countersigning.
alter table public.envelope_recipients
  add column if not exists role text not null default 'signer'
    check (role in ('signer','owner'));
