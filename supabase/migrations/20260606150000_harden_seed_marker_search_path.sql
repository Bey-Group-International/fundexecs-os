-- Security hardening (database-linter 0011 function_search_path_mutable).
-- private.seed_marker shipped without a fixed search_path while the other
-- seed_* functions set it. The body only concatenates a string literal, so an
-- empty search_path is safe. Additive + idempotent. Already applied to prod.
alter function private.seed_marker(text) set search_path = '';
