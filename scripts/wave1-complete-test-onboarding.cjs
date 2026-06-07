/**
 * wave1-complete-test-onboarding.cjs
 * --------------------------------------------------------------------------
 * ONE-SHOT dev utility for the Wave-1 UI sprint screenshot pass.
 *
 * Flips `member_profiles.status` from 'in_progress' → 'complete' for three
 * specific test users so all five member-type Dashboard variants can be
 * captured without manually walking each through the Proof-of-Truth quiz.
 *
 * - Idempotent — re-runs are no-op for users already at 'complete'.
 * - Does not touch `test+investment_firm@` or `test+student@` (already
 *   verified as 'complete' from prior phases).
 * - Pure Supabase admin upsert — no UI code touched, no `lib/queries/auth`
 *   touched. This is a `scripts/` dev fixture only.
 *
 * Run:
 *   yarn wave1:complete-test-onboarding
 * Or:
 *   set -a && source .env.local && set +a && node scripts/wave1-complete-test-onboarding.cjs
 */
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = require('ws');
}
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://auth.fundexecs.com';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');

const ADMIN = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Exactly the three users currently stuck in 'in_progress' per the seed
// script's safety-net. Investment firm + student are intentionally OMITTED.
const EMAILS = [
  'test+individual_investor@fundexecs-staging.dev',
  'test+service_provider@fundexecs-staging.dev',
  'test+startup@fundexecs-staging.dev'
];

async function findUserByEmail(email) {
  let page = 1;
  while (page < 5) {
    const { data, error } = await ADMIN.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = (data.users || []).find((u) => u.email === email);
    if (found) return found;
    if ((data.users || []).length < 200) return null;
    page++;
  }
  return null;
}

async function flipOne(email) {
  const user = await findUserByEmail(email);
  if (!user) {
    console.log(`  [${email}] not found — skip`);
    return { email, before: null, after: null, action: 'skip:no-user' };
  }
  const { data: existing } = await ADMIN.from('member_profiles')
    .select('user_id, status')
    .eq('user_id', user.id)
    .maybeSingle();
  const before = existing?.status ?? '(no row)';

  if (before === 'complete') {
    console.log(`  [${email}] already complete — no-op`);
    return { email, before, after: before, action: 'no-op' };
  }

  const { error: upErr } = await ADMIN.from('member_profiles').upsert(
    { user_id: user.id, status: 'complete' },
    { onConflict: 'user_id' }
  );
  if (upErr) {
    console.log(`  [${email}] upsert FAILED: ${upErr.message}`);
    return { email, before, after: before, action: `fail:${upErr.message}` };
  }
  console.log(`  [${email}] ${before} → complete`);
  return { email, before, after: 'complete', action: 'flipped' };
}

(async () => {
  console.log('Wave-1 onboarding completion flip — start');
  const results = [];
  for (const email of EMAILS) {
    results.push(await flipOne(email));
  }
  console.log('\nSummary:');
  for (const r of results) {
    console.log(`  - ${r.email}: ${r.before} → ${r.after}  (${r.action})`);
  }
})().catch((e) => {
  console.error('script failed:', e);
  process.exit(1);
});
