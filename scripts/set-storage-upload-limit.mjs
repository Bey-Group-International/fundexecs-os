#!/usr/bin/env node
// Raise (or lower) the Supabase project's GLOBAL Storage upload limit.
//
// The `documents` bucket allows 500 MB per file, but a bucket can never accept
// more than the project-wide limit, and that one lives in the Management API,
// not in a migration. On the Free plan it is fixed at 50 MB; after upgrading,
// run this, then raise NEXT_PUBLIC_DOCUMENT_MAX_UPLOAD_MB to match
// (docs/DOCUMENT_UPLOAD_LIMIT.md).
//
//   SUPABASE_ACCESS_TOKEN=sbp_… node scripts/set-storage-upload-limit.mjs \
//     --project <ref> --mb 500 [--dry-run]
//
// The token needs write access to the project's settings. The read-only token
// the DB Migrate workflow carries is deliberately not enough — use a personal
// token from Supabase → Account → Access Tokens, and revoke it afterwards.
//
// Only the file size limit changes: the current feature flags are read first
// and sent back as they are, so this never toggles S3 or image transformation.

const API = "https://api.supabase.com/v1";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const project = arg("project") ?? process.env.SUPABASE_PROJECT_REF;
const mb = Number(arg("mb") ?? "500");
const dryRun = process.argv.includes("--dry-run");
const token = process.env.SUPABASE_ACCESS_TOKEN;

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

if (!token) fail("Set SUPABASE_ACCESS_TOKEN (a personal access token with write access).");
if (!project) fail("Pass --project <ref> or set SUPABASE_PROJECT_REF.");
if (!Number.isFinite(mb) || mb <= 0) fail("--mb must be a positive number of megabytes.");

const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const bytes = Math.floor(mb * 1024 * 1024);
const fmt = (n) => `${Math.round(n / 1024 / 1024)} MB`;

async function readConfig() {
  const res = await fetch(`${API}/projects/${project}/config/storage`, { headers });
  if (res.status === 401) fail("Unauthorized — the access token is invalid or expired.");
  if (!res.ok) fail(`Could not read storage config (${res.status}): ${await res.text()}`);
  return res.json();
}

const current = await readConfig();
console.log(`Current global upload limit: ${fmt(current.fileSizeLimit)}`);
if (current.fileSizeLimit === bytes) {
  console.log(`Already ${fmt(bytes)} — nothing to do.`);
  process.exit(0);
}

const body = {
  fileSizeLimit: bytes,
  features: {
    imageTransformation: { enabled: Boolean(current.features?.imageTransformation?.enabled) },
    s3Protocol: { enabled: Boolean(current.features?.s3Protocol?.enabled) },
  },
};

if (dryRun) {
  console.log(`Dry run — would set ${fmt(bytes)} with:`, JSON.stringify(body));
  process.exit(0);
}

const res = await fetch(`${API}/projects/${project}/config/storage`, {
  method: "PATCH",
  headers,
  body: JSON.stringify(body),
});
if (res.status === 402 || /upgrade the project to a paid plan/i.test(await res.clone().text())) {
  fail("Supabase refused: the project is on the Free plan, which caps uploads at 50 MB. Upgrade it (Settings → Billing), then run this again.");
}
if (!res.ok) fail(`Update failed (${res.status}): ${await res.text()}`);

const after = await readConfig();
if (after.fileSizeLimit !== bytes) {
  fail(`Update reported success but the limit reads ${fmt(after.fileSizeLimit)}.`);
}
console.log(`✔ Global upload limit is now ${fmt(after.fileSizeLimit)}.`);
console.log("Next: set NEXT_PUBLIC_DOCUMENT_MAX_UPLOAD_MB on Vercel to match and redeploy.");
