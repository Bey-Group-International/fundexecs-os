import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapCompanyResponse, mapPersonResponse } from './orthogonal';
import { mockEnrichmentProvider } from './mock';
import { companyCacheKey, personCacheKey } from './types';

/* ----------------------------------------------------------------------------
 * Enrichment pure-logic suite. No network: tests the defensive response
 * mappers (envelope unwrap + field aliasing + found-flag), the deterministic
 * mock, and canonical cache keys.
 * -------------------------------------------------------------------------- */

test('mapPersonResponse unwraps a data envelope and aliases fields', () => {
  const p = mapPersonResponse({
    data: {
      full_name: 'Jane Doe',
      job_title: 'CFO',
      company_name: 'Acme',
      work_email: 'JANE@ACME.COM',
      phone_numbers: ['+1 555 0100']
    }
  });
  assert.equal(p.found, true);
  assert.equal(p.fullName, 'Jane Doe');
  assert.equal(p.title, 'CFO');
  assert.equal(p.company, 'Acme');
  assert.deepEqual(p.emails, ['jane@acme.com']); // lowercased
  assert.deepEqual(p.phones, ['+1 555 0100']);
});

test('mapPersonResponse returns found:false on an empty payload', () => {
  assert.equal(mapPersonResponse({}).found, false);
  assert.equal(mapPersonResponse(null).found, false);
});

test('mapCompanyResponse coerces numbers and lowercases domain', () => {
  const c = mapCompanyResponse({
    result: { name: 'Acme', website: 'Acme.COM', employees: '250', industry: 'SaaS' }
  });
  assert.equal(c.found, true);
  assert.equal(c.domain, 'acme.com');
  assert.equal(c.employeeCount, 250);
  assert.equal(c.industry, 'SaaS');
});

test('mock provider only "finds" when given an identity', async () => {
  assert.equal((await mockEnrichmentProvider.enrichPerson({})).found, false);
  assert.equal((await mockEnrichmentProvider.enrichPerson({ email: 'a@b.com' })).found, true);
  assert.equal((await mockEnrichmentProvider.enrichCompany({})).found, false);
  assert.equal((await mockEnrichmentProvider.enrichCompany({ domain: 'b.com' })).found, true);
});

test('cache keys are canonical (email/domain, lowercased)', () => {
  assert.equal(personCacheKey({ email: 'Jane@Acme.com' }), 'jane@acme.com');
  assert.equal(companyCacheKey({ domain: 'Acme.COM' }), 'acme.com');
  assert.equal(personCacheKey({ fullName: 'Jane Doe', company: 'Acme' }), 'jane doe|acme');
});
