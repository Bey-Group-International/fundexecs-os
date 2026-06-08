import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInviteRole } from './invites';

/* ----------------------------------------------------------------------------
 * Invite-role parsing regression suite.
 *
 * The `role:` token an admin types feeds the owner-grant escalation guard, so
 * its parsing must stay exact: an unrecognized or absent token defaults to the
 * least-privileged `member`, never silently to a higher role.
 * --------------------------------------------------------------------------*/

test('defaults to member when there is no note', () => {
  assert.deepEqual(parseInviteRole(), { role: 'member', note: null });
  assert.deepEqual(parseInviteRole(''), { role: 'member', note: null });
  assert.deepEqual(parseInviteRole('   '), { role: 'member', note: null });
});

test('parses a leading role token and keeps the rest as the human note', () => {
  assert.deepEqual(parseInviteRole('role: owner — co-founder'), {
    role: 'owner',
    note: 'co-founder'
  });
  assert.deepEqual(parseInviteRole('role:admin'), { role: 'admin', note: null });
  assert.deepEqual(parseInviteRole('ROLE: Member, ops lead'), {
    role: 'member',
    note: 'ops lead'
  });
});

test('a note without a valid role token defaults to member and keeps the full text', () => {
  assert.deepEqual(parseInviteRole('please add to the deal team'), {
    role: 'member',
    note: 'please add to the deal team'
  });
  // An unsupported role word is NOT a valid token — must not leak a higher role.
  assert.deepEqual(parseInviteRole('role: superuser'), {
    role: 'member',
    note: 'role: superuser'
  });
});
