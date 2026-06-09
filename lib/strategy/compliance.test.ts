import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agedPriority,
  COMPLIANCE_OWNER_SLUG,
  COMPLIANCE_STALE_DAYS,
  type ComplianceAgingInput
} from './compliance';

const NOW = new Date('2026-06-09T00:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const open: ComplianceAgingInput = {
  priority: 'Medium',
  open: true,
  read: false,
  updatedAt: daysAgo(0)
};

test('an open, unread, stale objective ages into High', () => {
  assert.equal(
    agedPriority({ ...open, updatedAt: daysAgo(COMPLIANCE_STALE_DAYS + 1) }, NOW),
    'High'
  );
});

test('exactly at the threshold ages into High', () => {
  assert.equal(agedPriority({ ...open, updatedAt: daysAgo(COMPLIANCE_STALE_DAYS) }, NOW), 'High');
});

test('a fresh objective keeps its priority', () => {
  assert.equal(agedPriority({ ...open, updatedAt: daysAgo(1) }, NOW), 'Medium');
});

test('a read objective never ages (operator already saw it)', () => {
  assert.equal(agedPriority({ ...open, read: true, updatedAt: daysAgo(90) }, NOW), 'Medium');
});

test('a closed objective never ages', () => {
  assert.equal(agedPriority({ ...open, open: false, updatedAt: daysAgo(90) }, NOW), 'Medium');
});

test('already-High is returned unchanged (idempotent)', () => {
  assert.equal(agedPriority({ ...open, priority: 'High', updatedAt: daysAgo(90) }, NOW), 'High');
});

test('Low ages all the way to High when stale', () => {
  assert.equal(agedPriority({ ...open, priority: 'Low', updatedAt: daysAgo(30) }, NOW), 'High');
});

test('a malformed updatedAt degrades to the current priority', () => {
  assert.equal(agedPriority({ ...open, updatedAt: 'not-a-date' }, NOW), 'Medium');
});

test('a custom staleDays threshold is honored', () => {
  assert.equal(agedPriority({ ...open, updatedAt: daysAgo(3) }, NOW, 2), 'High');
  assert.equal(agedPriority({ ...open, updatedAt: daysAgo(1) }, NOW, 2), 'Medium');
});

test('the compliance owner slug is Adrian (legal-admin, GC/Compliance)', () => {
  assert.equal(COMPLIANCE_OWNER_SLUG, 'legal-admin');
});
