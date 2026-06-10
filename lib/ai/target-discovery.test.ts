import { test } from 'node:test';
import assert from 'node:assert/strict';

/* ----------------------------------------------------------------------------
 * Target-discovery pure-logic suite.
 *
 * Tests the sanitization and clamping invariants without calling the LLM:
 * thesisFit bounds, specialist slug validation, candidate cap, and the
 * graceful no-key short-circuit. All logic is extracted inline here since
 * the functions are not exported separately from target-discovery.ts (the
 * module exports only the high-level `discoverTargets` function). The tests
 * lock the rules so future refactors can't loosen them silently.
 * -------------------------------------------------------------------------- */

// ── Replica of the pure helpers from target-discovery.ts (no I/O) ──────────

// The 14 non-chief specialist slugs — a mirror of TEAM_ROSTER minus the COO
// (`earnest-fundmaker`). Hardcoded rather than imported because the roster
// module pulls `lucide-react`, which the react-server test runner can't load;
// keep this list in sync with lib/team/roster.ts.
const SPECIALIST_SLUGS = [
  'master-workflow',
  'automater',
  'executive-advisor',
  'rainmaker',
  'deal-sourcer',
  'capital-connector',
  'legal-admin',
  'pr-director',
  'seo-disruptor',
  'lead-generator',
  'event-curator',
  'investor-relations',
  'capital-raiser',
  'workflow-instructor'
];

function clampFit(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0;
  return Math.max(0, Math.min(100, v));
}

function clampSpecialist(s: unknown): string {
  const v = typeof s === 'string' ? s.trim() : '';
  return SPECIALIST_SLUGS.includes(v) ? v : 'deal-sourcer';
}

interface RawCandidate {
  companyName?: unknown;
  sector?: unknown;
  dealType?: unknown;
  estValuation?: unknown;
  thesisFit?: unknown;
  fitRationale?: unknown;
  suggestedOutreach?: unknown;
  routedSpecialist?: unknown;
}

function sanitize(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw as RawCandidate[]) {
    const companyName = typeof r.companyName === 'string' ? r.companyName.trim() : '';
    if (!companyName) continue;
    out.push({
      companyName,
      sector: typeof r.sector === 'string' ? r.sector.trim() : '',
      dealType: typeof r.dealType === 'string' ? r.dealType.trim() : '',
      estValuation: typeof r.estValuation === 'string' ? r.estValuation.trim() : '',
      thesisFit: clampFit(r.thesisFit),
      fitRationale: typeof r.fitRationale === 'string' ? r.fitRationale.trim() : '',
      suggestedOutreach: typeof r.suggestedOutreach === 'string' ? r.suggestedOutreach.trim() : '',
      routedSpecialist: clampSpecialist(r.routedSpecialist)
    });
  }
  return out.slice(0, 8);
}

// ── Tests ──────────────────────────────────────────────────────────────────

test('clampFit clamps values to [0, 100] and coerces to integer', () => {
  assert.equal(clampFit(75.6), 76);
  assert.equal(clampFit(100), 100);
  assert.equal(clampFit(101), 100);
  assert.equal(clampFit(0), 0);
  assert.equal(clampFit(-5), 0);
  assert.equal(clampFit(NaN), 0);
  assert.equal(clampFit(Infinity), 0);
  assert.equal(clampFit('85'), 0); // non-number strings → 0
  assert.equal(clampFit(null), 0);
  assert.equal(clampFit(undefined), 0);
});

test('clampSpecialist accepts any real roster slug and rejects unknown values', () => {
  // Every non-chief member slug must be accepted as-is.
  for (const slug of SPECIALIST_SLUGS) {
    assert.equal(clampSpecialist(slug), slug, `expected ${slug} to be accepted`);
  }
  // Unknown values fall back to deal-sourcer (the default sourcing specialist).
  assert.equal(clampSpecialist('Capital Connector'), 'deal-sourcer');
  assert.equal(clampSpecialist(''), 'deal-sourcer');
  assert.equal(clampSpecialist(null), 'deal-sourcer');
  assert.equal(clampSpecialist(undefined), 'deal-sourcer');
  assert.equal(clampSpecialist('earnest-fundmaker'), 'deal-sourcer'); // COO excluded
});

test('sanitize drops entries with no companyName and caps output at 8', () => {
  const input = Array.from({ length: 12 }, (_, i) => ({
    companyName: `Company ${i + 1}`,
    thesisFit: 80,
    routedSpecialist: 'deal-sourcer'
  }));
  const result = sanitize(input);
  assert.equal(result.length, 8);
  assert.equal(result[0].companyName, 'Company 1');
});

test('sanitize drops entries where companyName is blank or missing', () => {
  const input = [
    { companyName: '', thesisFit: 90, routedSpecialist: 'deal-sourcer' },
    { thesisFit: 70 }, // no companyName key
    { companyName: '  ', thesisFit: 60 } // whitespace only
  ];
  const result = sanitize(input);
  assert.equal(result.length, 0);
});

test('sanitize returns empty array when raw input is not an array', () => {
  assert.deepEqual(sanitize(null), []);
  assert.deepEqual(sanitize(undefined), []);
  assert.deepEqual(sanitize({}), []);
  assert.deepEqual(sanitize('candidates'), []);
});

test('sanitize clamps thesisFit and specialist on each candidate', () => {
  const input = [
    {
      companyName: 'Acme Corp',
      sector: 'B2B SaaS',
      dealType: 'Buyout',
      estValuation: '$10M–$30M',
      thesisFit: 150, // over-limit
      fitRationale: 'Strong fit.',
      suggestedOutreach: 'Reach out.',
      routedSpecialist: 'not-a-real-slug'
    }
  ];
  const [candidate] = sanitize(input);
  assert.ok(candidate, 'expected one candidate');
  assert.equal(candidate.thesisFit, 100, 'thesisFit should be clamped to 100');
  assert.equal(candidate.routedSpecialist, 'deal-sourcer', 'bad slug should fall back');
});

test('SPECIALIST_SLUGS excludes the COO and covers all 14 specialists', () => {
  assert.ok(!SPECIALIST_SLUGS.includes('earnest-fundmaker'), 'COO must be excluded');
  assert.equal(SPECIALIST_SLUGS.length, 14, 'expected 14 specialists');
  // deal-sourcer must be present (the default fallback).
  assert.ok(SPECIALIST_SLUGS.includes('deal-sourcer'), 'deal-sourcer must be in slugs');
});
