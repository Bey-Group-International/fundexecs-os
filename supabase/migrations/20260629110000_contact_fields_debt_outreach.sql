-- Add contact and source fields to debt_facilities and outreach_enrollments.

-- debt_facilities
ALTER TABLE public.debt_facilities
  ADD COLUMN IF NOT EXISTS contact_name   text,
  ADD COLUMN IF NOT EXISTS contact_email  text,
  ADD COLUMN IF NOT EXISTS contact_phone  text,
  ADD COLUMN IF NOT EXISTS role           text,
  ADD COLUMN IF NOT EXISTS website        text,
  ADD COLUMN IF NOT EXISTS url_source     text;

-- outreach_enrollments (subject_name and subject_email already exist)
ALTER TABLE public.outreach_enrollments
  ADD COLUMN IF NOT EXISTS subject_phone  text,
  ADD COLUMN IF NOT EXISTS subject_role   text;
