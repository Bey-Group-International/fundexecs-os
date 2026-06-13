import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/* ============================================================================
 * Migration version-collision guard.
 *
 * Supabase keys `schema_migrations` on the version (the leading digits of each
 * filename), so two migrations that share a version make the second insert
 * fail with a duplicate key — breaking every `db push` / preview deploy. This
 * has bitten the repo repeatedly when parallel branches each pick the same
 * `2026MMDDHHMMSS` timestamp (fixed reactively in #375, #379, #382, #384, #389).
 *
 * This guard turns that into a fast, deterministic failure at PR time: it
 * scans the migrations directory and asserts every version prefix is unique,
 * so a collision is caught before merge instead of on deploy. Renumber the
 * newer file (migrations are additive + idempotent) to resolve a failure.
 * ========================================================================= */

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

test('every migration filename starts with a numeric version', () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  assert.ok(files.length > 0, 'no .sql migrations found — check the path');
  for (const f of files) {
    assert.match(
      f,
      /^\d+_/,
      `migration "${f}" must start with a numeric version and an underscore`
    );
  }
});

test('migration versions are unique (no parallel-branch collisions)', () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  const byVersion = new Map<string, string[]>();
  for (const f of files) {
    const version = /^(\d+)/.exec(f)?.[1] ?? f;
    byVersion.set(version, [...(byVersion.get(version) ?? []), f]);
  }
  const collisions = [...byVersion.entries()].filter(([, names]) => names.length > 1);
  assert.equal(
    collisions.length,
    0,
    `duplicate migration versions (renumber the newer file):\n${collisions
      .map(([v, names]) => `  ${v}: ${names.join(', ')}`)
      .join('\n')}`
  );
});
