/* Introspect live DB schema for Phase 4/5 tables and dump the column
   list so we can write additive type augmentations to
   database.types.ts. Service-role key only. */
const ws = require('ws');
const { createClient } = require('@supabase/supabase-js');

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: ws } }
);

// Phase 4 / 5 tables we touched.
const TABLES = [
  'evidence',
  'chain_of_trust_records',
  'proof_layers',
  'trust_events',
  'notifications',
  'org_members',
  'profiles',
  'deals',
  'allocations',
  'objectives',
  'objective_results',
  'capital_providers',
  'partnerships',
  'contacts',
  'interactions',
  'organizations',
  'audit_logs'
];

(async () => {
  for (const t of TABLES) {
    // Use PostgREST-compatible introspection via select * limit 1 to
    // get column metadata via the response shape, but information_schema
    // is more reliable. Use a Postgres function call instead.
    // Easiest: select one row, examine keys. Fall back to empty result is fine.
    const { data } = await admin.from(t).select('*').limit(1);
    if (!data || data.length === 0) {
      // try to get column names via an explicit head request — supabase-js v2 doesn't
      // expose that. Use rpc instead by hand-rolling.
      console.log(`\n--- ${t} (no rows; sample skipped) ---`);
      continue;
    }
    const cols = Object.keys(data[0]).sort();
    console.log(`\n--- ${t} ---`);
    for (const c of cols) {
      const v = data[0][c];
      const ty = v === null ? 'null' : Array.isArray(v) ? `array(len=${v.length})` : typeof v;
      const sample =
        typeof v === 'string'
          ? `"${v.slice(0, 40)}${v.length > 40 ? '…' : ''}"`
          : JSON.stringify(v);
      console.log(`  ${c} :: ${ty} = ${sample}`);
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error('ERR:', e.message);
  process.exit(1);
});
