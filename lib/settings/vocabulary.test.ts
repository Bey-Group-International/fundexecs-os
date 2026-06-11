import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_TABS, resolveSettingsTab, oauthBanner } from './vocabulary';

/* ----------------------------------------------------------------------------
 * Settings vocabulary regression suite.
 *
 * Locks the contracts the /settings page and the OAuth redirect shim depend
 * on: tab ids resolve safely from untrusted query params, and the post-OAuth
 * banner gives error precedence over a stale success param.
 * --------------------------------------------------------------------------*/

test('the three sections exist in display order', () => {
  assert.deepEqual(
    SETTINGS_TABS.map((t) => t.id),
    ['account', 'workspace', 'integrations']
  );
});

test('resolveSettingsTab accepts every valid id', () => {
  for (const t of SETTINGS_TABS) {
    assert.equal(resolveSettingsTab(t.id), t.id);
  }
});

test('resolveSettingsTab defaults junk to account', () => {
  assert.equal(resolveSettingsTab('billing'), 'account');
  assert.equal(resolveSettingsTab(undefined), 'account');
  assert.equal(resolveSettingsTab(['integrations']), 'account');
  assert.equal(resolveSettingsTab(42), 'account');
});

test('oauthBanner is null with no params', () => {
  assert.equal(oauthBanner(undefined, undefined), null);
});

test('oauthBanner surfaces success with a readable provider name', () => {
  assert.deepEqual(oauthBanner('google', undefined), {
    tone: 'success',
    message: "Connected Google — you're wired in."
  });
  const slack = oauthBanner('google_calendar', undefined);
  assert.equal(slack?.tone, 'success');
  assert.match(slack?.message ?? '', /google calendar/);
});

test('oauthBanner gives error precedence over a stale connected param', () => {
  assert.deepEqual(oauthBanner('google', 'Token exchange failed'), {
    tone: 'danger',
    message: 'Token exchange failed'
  });
});
