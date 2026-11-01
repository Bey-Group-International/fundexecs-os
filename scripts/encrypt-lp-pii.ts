// Encrypt LP profile columns that were stored as plaintext before
// FIELD_ENCRYPTION_KEYS was configured.
//
//   npx tsx scripts/encrypt-lp-pii.ts            # dry run: counts only
//   npx tsx scripts/encrypt-lp-pii.ts --apply    # write
//
// Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FIELD_ENCRYPTION_KEYS.
// Safe to re-run: values already encrypted are skipped. Run it once after the
// key is live in production, and never print what it reads.
import { createClient } from "@supabase/supabase-js";
import { fieldEncryptionConfigured, isEncrypted } from "../lib/crypto/field-encryption";
import { LP_PROFILE_SEALED_COLUMNS, sealProfileWrite } from "../lib/lp-pii";

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  if (!fieldEncryptionConfigured()) throw new Error("FIELD_ENCRYPTION_KEYS is not set; nothing would be encrypted");

  const db = createClient(url, key, { auth: { persistSession: false } });
  const cols = ["session_id", ...LP_PROFILE_SEALED_COLUMNS].join(", ");
  const { data, error } = await db.from("lp_onboarding_profiles").select(cols);
  if (error) throw new Error(`read failed: ${error.message}`);

  let todo = 0;
  let done = 0;
  for (const row of (data ?? []) as unknown as Record<string, string | null>[]) {
    const patch: Record<string, string | null> = {};
    for (const c of LP_PROFILE_SEALED_COLUMNS) {
      if (row[c] && !isEncrypted(row[c])) patch[c] = row[c];
    }
    if (Object.keys(patch).length === 0) continue;
    todo++;
    if (!apply) continue;
    const { error: upErr } = await db
      .from("lp_onboarding_profiles")
      .update(sealProfileWrite(row.session_id as string, patch))
      .eq("session_id", row.session_id as string);
    if (upErr) console.error(`session ${row.session_id}: ${upErr.message}`);
    else done++;
  }
  console.log(apply ? `encrypted ${done} of ${todo} rows with plaintext` : `${todo} rows have plaintext (dry run; pass --apply to encrypt)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
