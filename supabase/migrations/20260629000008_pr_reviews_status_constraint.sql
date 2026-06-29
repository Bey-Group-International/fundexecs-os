-- P0-3: Add CHECK constraint on pr_reviews.review_status to prevent arbitrary
-- values from being written by external agents. All existing rows use "reviewed".
-- Constraint is lenient enough to cover standard PR review states.
-- Guard: skip entirely if the table does not exist (e.g. preview branches).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'pr_reviews'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pr_reviews_review_status_check'
      AND conrelid = 'public.pr_reviews'::regclass
  ) THEN
    ALTER TABLE public.pr_reviews
      ADD CONSTRAINT pr_reviews_review_status_check
      CHECK (review_status IN (
        'pending',
        'reviewed',
        'approved',
        'changes_requested',
        'dismissed'
      ));
  END IF;
END $$;
