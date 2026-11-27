-- 20261127120000_signature_block_other.sql
--
-- One more signature block: "other", a text block the sender names themselves (the name is
-- kept in the existing label column). The block-type check on envelope_fields is replaced
-- with one that also allows it; every earlier type stays valid.

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
                        'name','datetime','company','title','address','email','phone','other'));
