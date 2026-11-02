-- 20261102150000_signature_images.sql
--
-- A signature that is actually made. The LP subscription and data-room file
-- signatures now keep the signer's drawn (or typed-and-rendered) signature as a
-- small PNG data URL, which is stamped into the executed PDF beside their name.
-- Nullable so rows signed before this migration stay valid; the server requires
-- one for every new signature and re-checks it is a real, small PNG.

alter table public.lp_subscription_signatures
  add column if not exists signature_png text
    check (signature_png is null or (signature_png like 'data:image/png;base64,%' and char_length(signature_png) <= 210000));

alter table public.data_room_document_signatures
  add column if not exists signature_png text
    check (signature_png is null or (signature_png like 'data:image/png;base64,%' and char_length(signature_png) <= 210000));
