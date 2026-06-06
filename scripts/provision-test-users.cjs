/**
 * One-shot provisioning script — DO NOT commit env values.
 *
 * Creates 5 test users (one per member_type) via the service-role admin
 * client, waits for `handle_new_user` to fire on the live DB, then calls
 * the per-type seed RPC and reports row counts.
 *
 * Run (preferred, auto-loads .env.local via Node ≥20.6 native --env-file):
 *   yarn seed:test-users
 *
 * Run (manual env sourcing):
 *   set -a && source .env.local && set +a && node scripts/provision-test-users.cjs
 *
 * Idempotent: re-runs reuse existing users and the seed RPCs skip rows
 * they've already inserted (keyed off `notifications.payload->>'tag'`).
 *
 * Canonical credentials + row-count snapshot live at:
 *   /app/memory/test_credentials.md
 * — keep that file in sync with anything this script changes (member_type,
 * shared password, status, etc.).
 */
// Node 20 in this pod lacks a native global WebSocket; the realtime client
// will crash at import otherwise. Polyfill before requiring supabase-js.
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

// Never bake a working credential into the (public) repo. The canonical test
// password is provisioned per-environment via TEST_USER_PASSWORD.
const PASSWORD = process.env.TEST_USER_PASSWORD;
if (!PASSWORD) throw new Error('TEST_USER_PASSWORD missing');
const TYPES = ['investment_firm', 'service_provider', 'startup', 'student', 'individual_investor'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findExistingByEmail(email) {
  // The admin API doesn't have a single-email lookup; list users and filter.
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

async function provisionOne(memberType) {
  const email = `test+${memberType}@fundexecs-staging.dev`;
  let user = await findExistingByEmail(email);
  if (!user) {
    const { data, error } = await ADMIN.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: testNameFor(memberType) }
    });
    if (error) throw new Error(`createUser ${memberType}: ${error.message}`);
    user = data.user;
    // Give the `handle_new_user` trigger a beat to populate the org + baseline.
    await sleep(2000);
  } else {
    console.log(`  [${memberType}] user already exists, reusing ${user.id}`);
    // Idempotency guarantee: re-apply the canonical password so the
    // documented `/app/memory/test_credentials.md` value always works.
    // Without this, a tester / external admin password change would
    // silently drift from the docs.
    const { error: pwErr } = await ADMIN.auth.admin.updateUserById(user.id, { password: PASSWORD });
    if (pwErr) console.warn(`  [${memberType}] password reset failed: ${pwErr.message}`);
  }

  // Resolve org_id (handle_new_user inserts an org_members row with role='owner').
  const { data: om, error: omErr } = await ADMIN.from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1);
  if (omErr) throw new Error(`org_members lookup ${memberType}: ${omErr.message}`);
  const orgId = om?.[0]?.org_id;
  if (!orgId) throw new Error(`no org for ${memberType} (trigger did not fire?)`);

  // Set member_type on the profile (the canonical home for it) and ensure a
  // member_profiles row exists. The trigger's baseline seed already inserts
  // one with status='in_progress'; we only insert here as a safety net for
  // re-runs where the baseline row may have been deleted. Crucially, we
  // DO NOT overwrite an existing row — if a tester (or psql) has manually
  // flipped the status to 'complete', a re-run of this script must not
  // silently downgrade them back to 'in_progress'.
  const { error: pErr } = await ADMIN.from('profiles')
    .update({ member_type: memberType })
    .eq('id', user.id);
  if (pErr) throw new Error(`profiles update ${memberType}: ${pErr.message}`);
  const { error: mpErr } = await ADMIN.from('member_profiles').upsert(
    { user_id: user.id, status: 'in_progress' },
    { onConflict: 'user_id', ignoreDuplicates: true }
  );
  if (mpErr) throw new Error(`member_profiles upsert ${memberType}: ${mpErr.message}`);

  // Fire the per-type top-up seed.
  const { error: seedErr } = await ADMIN.rpc('seed_demo_for_member_type', {
    _org: orgId,
    _user: user.id,
    _type: memberType
  });
  if (seedErr) throw new Error(`seed RPC ${memberType}: ${seedErr.message}`);

  // Row-count verification.
  const counts = await collectCounts(orgId, user.id);

  return { memberType, user, orgId, counts };
}

async function collectCounts(orgId, userId) {
  const tables = [
    ['organizations', { id: orgId }],
    ['org_members', { org_id: orgId }],
    ['profiles', { id: userId }],
    ['member_profiles', { user_id: userId }],
    ['deals', { org_id: orgId }],
    ['allocations', { org_id: orgId }],
    ['contacts', { org_id: orgId }],
    ['interactions', { org_id: orgId }],
    ['notifications', { org_id: orgId }],
    ['governance_plans', { org_id: orgId }],
    ['governance_objectives', { org_id: orgId }],
    ['chain_of_trust_records', { org_id: orgId }],
    ['warm_introductions', { org_id: orgId }],
    ['tasks', { org_id: orgId }],
    ['synergy_opportunities', { org_id: orgId }],
    ['capital_providers', { org_id: orgId }],
    ['service_providers', { org_id: orgId }],
    ['partnerships', { org_id: orgId }]
  ];
  const out = {};
  for (const [t, filter] of tables) {
    let q = ADMIN.from(t).select('*', { count: 'exact', head: true });
    for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
    const { count, error } = await q;
    if (error) {
      out[t] = `err:${error.message}`;
    } else {
      out[t] = count ?? 0;
    }
  }
  // also member_profile id (PK is user_id; use that)
  const { data: mp } = await ADMIN.from('member_profiles')
    .select('user_id, status')
    .eq('user_id', userId)
    .maybeSingle();
  out.member_profile_status = mp?.status ?? null;
  return out;
}

function testNameFor(memberType) {
  const tag = memberType.replace(/_/g, ' ');
  return `Test ${tag.replace(/\b\w/g, (c) => c.toUpperCase())}`;
}

(async () => {
  const results = [];
  for (const t of TYPES) {
    console.log(`provisioning ${t}…`);
    try {
      const r = await provisionOne(t);
      results.push(r);
      console.log(`  ✓ ${t} → user=${r.user.id} org=${r.orgId}`);
    } catch (e) {
      console.error(`  ✗ ${t} → ${e.message}`);
      results.push({ memberType: t, error: e.message });
    }
  }

  console.log('\n=== PASSWORD ===');
  console.log(PASSWORD);
  console.log('\n=== RESULTS ===');
  console.log(JSON.stringify(results, null, 2));
})();
