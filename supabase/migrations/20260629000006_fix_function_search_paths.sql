-- P2-5: Pin search_path on functions to prevent search_path injection.
-- set_updated_at is a trigger function; match_brain_kb_chunks uses pgvector from extensions schema.
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.match_brain_kb_chunks(query_embedding extensions.vector(256), target_brain_key text, match_count int) SET search_path = public, extensions;
