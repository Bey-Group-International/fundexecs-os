-- 20261002213000_nda_signature_record.sql
--
-- An NDA signature that stands up afterwards.
--
-- 1. Each signature keeps the exact text that was signed and its SHA-256
--    fingerprint, so editing a link's NDA (or the built-in default) never
--    changes what an earlier signer agreed to. `copy_sent_at` records when the
--    signer was emailed their copy.
-- 2. An NDA link always asks for the reader's email first: the signature's
--    email comes from that gate, server-side, never from the browser. Existing
--    NDA links without an email gate get one.

alter table public.nda_signatures
  add column if not exists nda_text text,
  add column if not exists nda_sha256 text,
  add column if not exists agreed boolean not null default false,
  add column if not exists copy_sent_at timestamptz;

update public.data_room_shares
   set require_email = true
 where require_nda and not require_email;

alter table public.data_room_shares
  drop constraint if exists data_room_shares_nda_needs_email;
alter table public.data_room_shares
  add constraint data_room_shares_nda_needs_email check (require_email or not require_nda);
