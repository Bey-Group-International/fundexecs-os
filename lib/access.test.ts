import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlatformAdmin, canManageOrg, canGrantOwnerRole, type OrgMembership } from './access';

/* ----------------------------------------------------------------------------
 * Access-boundary regression suite.
 *
 * Locks the org-scoped authorization decisions that the server gates
 * (requireOrgManager / requireOrgOwner) compose, so a future refactor can't
 * silently widen who can manage a workspace or mint an owner. Pure decisions
 * only — no DB, no auth session.
 * --------------------------------------------------------------------------*/

test('isPlatformAdmin matches only the Bey Group domain, case/space-insensitively', () => {
  for (const email of [
    'pres@beygroupintl.com',
    'PRES@BeyGroupIntl.com',
    '  vp@beygroupintl.com  '
  ]) {
    assert.equal(isPlatformAdmin(email), true, `expected platform admin for: ${email}`);
  }
  for (const email of [
    'owner@acme.com',
    'attacker@beygroupintl.com.evil.com', // suffix spoof must not match
    'beygroupintl.com@gmail.com',
    null,
    undefined,
    ''
  ]) {
    assert.equal(isPlatformAdmin(email), false, `expected NON admin for: ${String(email)}`);
  }
});

test('canManageOrg: platform admins always manage, regardless of membership', () => {
  assert.equal(canManageOrg(null, true), true);
  assert.equal(canManageOrg({ role: 'member', status: 'inactive' }, true), true);
});

test('canManageOrg: active owners and admins manage their own org', () => {
  assert.equal(canManageOrg({ role: 'owner', status: 'active' }, false), true);
  assert.equal(canManageOrg({ role: 'admin', status: 'active' }, false), true);
});

test('canManageOrg: members, inactive roles, and non-members cannot manage', () => {
  const denied: OrgMembership[] = [
    { role: 'member', status: 'active' },
    { role: 'owner', status: 'pending' },
    { role: 'admin', status: 'invited' },
    { role: null, status: 'active' },
    { role: 'owner', status: null },
    null
  ];
  for (const m of denied) {
    assert.equal(canManageOrg(m, false), false, `expected DENY for: ${JSON.stringify(m)}`);
  }
});

test('canGrantOwnerRole: only platform admins or active owners may mint an owner', () => {
  assert.equal(canGrantOwnerRole(null, true), true);
  assert.equal(canGrantOwnerRole({ role: 'owner', status: 'active' }, false), true);
});

test('canGrantOwnerRole: an org ADMIN cannot grant owner (escalation guard)', () => {
  // This is the privilege-escalation boundary: admins manage members but must
  // not be able to create a peer/superior owner.
  assert.equal(canGrantOwnerRole({ role: 'admin', status: 'active' }, false), false);
  assert.equal(canGrantOwnerRole({ role: 'member', status: 'active' }, false), false);
  assert.equal(canGrantOwnerRole({ role: 'owner', status: 'pending' }, false), false);
  assert.equal(canGrantOwnerRole(null, false), false);
});
