-- =====================================================================
-- Relationship Inbox — P3.1 reply threading.
--
-- Additive + idempotent. Stores the RFC822 Message-ID of the inbound email so
-- a sent reply can carry In-Reply-To / References headers and land in the same
-- Gmail conversation. The Gmail threadId is stored in the existing thread_id
-- column (populated by ingestion from this migration forward).
-- =====================================================================

alter table public.inbox_items
  add column if not exists reply_to_message_id text;
