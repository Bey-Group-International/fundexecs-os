#!/usr/bin/env node
/* ============================================================================
 * scripts/seed-e2e-user.mjs — create (or repair) the dedicated e2e test user.
 *
 * Run once against the Supabase project the authed e2e suite will hit:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
 *   E2E_TEST_EMAIL=e2e@yourdomain.com \
 *   E2E_TEST_PASSWORD=<strong-password> \
 *   npm run seed:e2e
 *
 * Idempotent: re-running resets the password and repairs any missing rows.
 * The user is shaped exactly like a finished onboarding so the middleware
 * never bounces the suite: confirmed auth user → profiles row →
 * member_profiles status 'complete' → owner of an active org.
 *
 * Then add E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY, E2E_TEST_EMAIL and
 * E2E_TEST_PASSWORD as GitHub Actions secrets — see e2e/README.md.
 * ========================================================================= */

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.E2E_TEST_EMAIL?.trim().toLowerCase();
const password = process.env.E2E_TEST_PASSWORD;

if (!url || url.includes('placeholder') || !serviceKey || !email || !password) {
  console.error(
    'Missing env. Required: NEXT_PUBLIC_SUPABASE_URL (real), SUPABASE_SERVICE_ROLE_KEY, E2E_TEST_EMAIL, E2E_TEST_PASSWORD.'
  );
  process.exit(1);
}
if (password.length < 8) {
  console.error('E2E_TEST_PASSWORD must be at least 8 characters.');
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

/** Find an existing auth user by email (paged — fine at test-project scale). */
async function findUserByEmail() {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  // 1. The confirmed auth user, with the password current either way.
  let user = await findUserByEmail();
  if (user) {
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true
    });
    if (error) throw new Error(`updateUserById: ${error.message}`);
    console.log(`auth user exists — password reset (${user.id})`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    user = data.user;
    console.log(`auth user created (${user.id})`);
  }

  // 2. The profile the shell renders.
  {
    const { error } = await admin
      .from('profiles')
      .upsert({ id: user.id, full_name: 'E2E Test Operator', role: 'Operator' });
    if (error) throw new Error(`profiles: ${error.message}`);
    console.log('profiles row ensured');
  }

  // 3. A completed member profile so the onboarding gate never bounces.
  {
    const { error } = await admin
      .from('member_profiles')
      .upsert({ user_id: user.id, status: 'complete' });
    if (error) throw new Error(`member_profiles: ${error.message}`);
    console.log('member_profiles complete');
  }

  // 4. An active org membership (owner). The live DB's `handle_new_user`
  // trigger usually provisions this on user creation — give it a moment
  // before falling back to creating the org ourselves.
  {
    let membership = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data, error: mErr } = await admin
        .from('org_members')
        .select('org_id, status')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      if (mErr) throw new Error(`org_members read: ${mErr.message}`);
      membership = data;
      if (membership) break;
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (membership) {
      if (membership.status !== 'active') {
        const { error } = await admin
          .from('org_members')
          .update({ status: 'active' })
          .eq('user_id', user.id)
          .eq('org_id', membership.org_id);
        if (error) throw new Error(`org_members repair: ${error.message}`);
      }
      console.log(`org membership ensured (${membership.org_id})`);
    } else {
      const { data: org, error: oErr } = await admin
        .from('organizations')
        .insert({ name: 'E2E Test Fund', type: 'fund' })
        .select('id')
        .single();
      if (oErr || !org) throw new Error(`organizations: ${oErr?.message}`);
      const { error } = await admin
        .from('org_members')
        .insert({ org_id: org.id, user_id: user.id, role: 'owner', status: 'active' });
      if (error) throw new Error(`org_members: ${error.message}`);
      console.log(`org created + owner membership (${org.id})`);
    }
  }

  console.log('\nSeed complete. Now set the GitHub Actions secrets:');
  console.log('  E2E_SUPABASE_URL       =', url);
  console.log('  E2E_SUPABASE_ANON_KEY  = <your anon/publishable key>');
  console.log('  E2E_TEST_EMAIL         =', email);
  console.log('  E2E_TEST_PASSWORD      = <the password you used>');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
