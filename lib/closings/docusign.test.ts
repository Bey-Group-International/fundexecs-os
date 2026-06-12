import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENVELOPE_DISPLAY,
  buildEnvelopeRequest,
  isEnvelopeOpen,
  isValidEmail,
  mapEnvelopeStatus,
  signatureSubject
} from './docusign';

test('isValidEmail accepts plausible addresses and rejects junk', () => {
  assert.equal(isValidEmail('signer@example.com'), true);
  assert.equal(isValidEmail('  signer@example.com  '), true);
  assert.equal(isValidEmail('no-at-sign'), false);
  assert.equal(isValidEmail('two@@example.com'), false);
  assert.equal(isValidEmail('missing@tld'), false);
  assert.equal(isValidEmail(''), false);
});

test('signatureSubject pairs counterparty with the step', () => {
  assert.equal(
    signatureSubject('Granite Endowment', 'Countersigned'),
    'Granite Endowment — Countersigned'
  );
  // Falls back to the step name alone when there's no counterparty.
  assert.equal(signatureSubject(null, 'Countersigned'), 'Countersigned');
  assert.equal(signatureSubject('   ', 'Countersigned'), 'Countersigned');
});

test('mapEnvelopeStatus narrows DocuSign lifecycle states', () => {
  assert.equal(mapEnvelopeStatus('sent'), 'sent');
  assert.equal(mapEnvelopeStatus('Delivered'), 'delivered');
  assert.equal(mapEnvelopeStatus('completed'), 'completed');
  assert.equal(mapEnvelopeStatus('signed'), 'completed');
  assert.equal(mapEnvelopeStatus('declined'), 'declined');
  assert.equal(mapEnvelopeStatus('voided'), 'voided');
  assert.equal(mapEnvelopeStatus('created'), 'created');
  // Unknown states degrade to the safe in-flight default.
  assert.equal(mapEnvelopeStatus(undefined), 'sent');
  assert.equal(mapEnvelopeStatus('weird'), 'sent');
});

test('isEnvelopeOpen tracks whether signatures are still expected', () => {
  assert.equal(isEnvelopeOpen('sent'), true);
  assert.equal(isEnvelopeOpen('delivered'), true);
  assert.equal(isEnvelopeOpen('created'), true);
  assert.equal(isEnvelopeOpen('completed'), false);
  assert.equal(isEnvelopeOpen('declined'), false);
  assert.equal(isEnvelopeOpen('voided'), false);
});

test('every display status has a tone and label', () => {
  for (const key of ['created', 'sent', 'delivered', 'completed', 'declined', 'voided'] as const) {
    assert.ok(ENVELOPE_DISPLAY[key].label.length > 0);
    assert.ok(['neutral', 'gold', 'success', 'danger'].includes(ENVELOPE_DISPLAY[key].tone));
  }
});

test('buildEnvelopeRequest shapes a template-based send, trimming recipient input', () => {
  const req = buildEnvelopeRequest({
    templateId: 'tpl-1',
    roleName: 'Signer',
    subject: 'Granite — Countersigned',
    signerName: '  Jane Lee  ',
    signerEmail: '  jane@granite.org  '
  });
  assert.equal(req.templateId, 'tpl-1');
  assert.equal(req.status, 'sent');
  assert.equal(req.emailSubject, 'Granite — Countersigned');
  assert.deepEqual(req.templateRoles, [
    { email: 'jane@granite.org', name: 'Jane Lee', roleName: 'Signer' }
  ]);
});
