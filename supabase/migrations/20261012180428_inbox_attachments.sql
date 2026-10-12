-- Files attached to inbox replies.
--
-- Uploaded straight from the browser to Storage over a signed upload URL (a
-- Server Action body is capped around a megabyte), into a private bucket of
-- their own: an attachment is not a library document, and nothing here is
-- served to anyone but the mail sender (service role) and, for files too big
-- for Gmail, a short-lived signed download link. Paths are
-- `<organization_id>/<uuid>/<file name>`; the server checks the org prefix
-- before it reads anything.
--
-- No storage policies: every read and write goes through the service role,
-- after the app has established who is asking and for which org.
insert into storage.buckets (id, name, public, file_size_limit)
values ('inbox-attachments', 'inbox-attachments', false, 104857600)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;
