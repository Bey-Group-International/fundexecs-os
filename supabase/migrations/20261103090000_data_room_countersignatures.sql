-- 20261103090000_data_room_countersignatures.sql
--
-- The fund counter-signs a file a reader signed in a data room (say, an NDA).
-- One counter-signature per signature, kept on the same row so the signature and
-- its counter-signature can never drift apart. Written by the server only (service
-- role), after it has checked the member is an owner or admin of the organisation.
--
-- `countersigned_at is null` is "awaiting counter-signature". The server sets the
-- columns together and only while that is still null, so a second attempt cannot
-- overwrite the first.

alter table public.data_room_document_signatures
  add column if not exists countersigner_name text,
  add column if not exists countersigner_email text,
  add column if not exists countersigner_user_id uuid,
  add column if not exists countersigned_at timestamptz,
  add column if not exists countersignature_png text
    check (countersignature_png is null or (countersignature_png like 'data:image/png;base64,%' and char_length(countersignature_png) <= 210000)),
  add column if not exists countersign_copy_sent_at timestamptz;

-- The Activity tab's "awaiting counter-signature" list.
create index if not exists data_room_document_signatures_awaiting_idx
  on public.data_room_document_signatures (room_id, signed_at desc)
  where countersigned_at is null;
