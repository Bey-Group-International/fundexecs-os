-- 20261103140000_data_room_signature_envelopes.sql
--
-- A data-room file that needs a signature goes through the same place-blocks, send,
-- sign, countersign flow as any other document.
--
-- 1. The owner places signature blocks on the file once. They are kept on the room's
--    publish row (`signature_blocks`, a list of blocks for "signer" and "owner").
-- 2. Each reader who opens the file gets their own envelope, copied from the file with
--    those blocks, tied to the link they came through (`data_room_share_id`), the file
--    (`data_room_document_id`) and their email (`reader_email`). One per reader per
--    file per link; a voided one frees the slot.
-- The older signature table stays: the signatures already in it still unlock their
-- files, and can still be countersigned.

alter table public.data_room_documents
  add column if not exists signature_blocks jsonb
    check (signature_blocks is null or jsonb_typeof(signature_blocks) = 'array');

alter table public.envelopes
  add column if not exists data_room_share_id uuid references public.data_room_shares (id) on delete set null,
  add column if not exists data_room_document_id uuid references public.documents (id) on delete set null,
  add column if not exists reader_email text;

create unique index if not exists envelopes_one_per_reader_document
  on public.envelopes (data_room_share_id, data_room_document_id, lower(reader_email))
  where data_room_share_id is not null and status <> 'voided';
