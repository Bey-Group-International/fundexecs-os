'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const SubmissionSchema = z.object({
  company_name: z.string().min(1).max(120),
  website: z.string().url().optional().or(z.literal('')),
  stage: z.enum(['pre-seed', 'seed', 'series-a', 'series-b+']),
  raise_amount: z
    .preprocess((v) => (v === '' ? undefined : v), z.coerce.number().positive())
    .optional(),
  deck_url: z.string().url().optional().or(z.literal('')),
  description: z.string().max(1000).optional(),
  founder_name: z.string().min(1).max(120),
  founder_email: z.string().email()
});

export type SubmissionResult = { ok: true } | { ok: false; error: string };

export async function submitDeal(formData: FormData): Promise<SubmissionResult> {
  const raw = Object.fromEntries(formData);
  const parsed = SubmissionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const db = createAdminClient();
  const { error } = await db.from('deal_submissions').insert({
    ...parsed.data,
    website: parsed.data.website || null,
    deck_url: parsed.data.deck_url || null
  });

  if (error) return { ok: false, error: 'Submission failed. Please try again.' };
  return { ok: true };
}

const InterestSchema = z.object({
  deal_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  email: z.string().email(),
  note: z.string().max(500).optional()
});

export type InterestResult = { ok: true } | { ok: false; error: string };

export async function expressInterest(formData: FormData): Promise<InterestResult> {
  const raw = Object.fromEntries(formData);
  const parsed = InterestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const db = createAdminClient();
  const { error } = await db.from('deal_interest_captures').insert(parsed.data);

  if (error) return { ok: false, error: 'Could not submit interest. Please try again.' };
  return { ok: true };
}

export async function getPublicRaise(slug: string) {
  const db = await createClient();
  const { data } = await db
    .from('deals')
    .select(
      'id, name, stage, raise_summary, target_amount, committed_amount, close_date, deck_url, founder_name, company_website, created_at'
    )
    .eq('public_slug', slug)
    .eq('public_visible', true)
    .single();
  return data;
}
