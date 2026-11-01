-- SOC 2 gap G-7: keep the OFAC list each screen matched against.
--
-- Every screen's audit entry carries a SHA-256 of the two Treasury files it used.
-- That proves WHICH list, but Treasury does not publish past versions at a stable
-- address, so nobody could reproduce a screen later. The app now stores each
-- distinct file once, under its own fingerprint (`<sha256>.csv`), in this bucket.
--
-- Private, and no policies on purpose: with row-level security on storage.objects
-- and nothing granting access, only the service role (which the server uses to
-- write, and an auditor's export uses to read) can touch these objects. Nothing
-- in the file names an LP; the list is public data.
insert into storage.buckets (id, name, public, file_size_limit)
values ('ofac-lists', 'ofac-lists', false, 33554432)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;
