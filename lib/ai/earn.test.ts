import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickChatModel, earnToolMode, EARN_NAV_DESTINATIONS } from './earn';
import { AI_MODELS } from './models';

/* ----------------------------------------------------------------------------
 * Earn deterministic-logic regression suite.
 *
 * These lock the behaviour we deliberately tuned (model escalation, tool
 * confirm-vs-auto, the navigation allowlist) so a future prompt/model/refactor
 * can't silently regress it. Pure functions only — no network, no API key.
 * --------------------------------------------------------------------------*/

test('pickChatModel escalates clearly analytical turns to the reasoning tier', () => {
  for (const ask of [
    'Analyze my pipeline conversion by stage',
    'Compare deal A and deal B on unit economics',
    'Evaluate the downside scenario here',
    'Run a stress test on these projections',
    'What valuation does this support?',
    'Recommend my next three moves'
  ]) {
    assert.equal(pickChatModel(ask), AI_MODELS.reasoning, `expected escalation for: ${ask}`);
  }
});

test('pickChatModel escalates very long turns regardless of keywords', () => {
  const longAsk = 'walk me through this '.repeat(20); // > 280 chars, no analytical word
  assert.ok(longAsk.length > 280);
  assert.equal(pickChatModel(longAsk), AI_MODELS.reasoning);
});

test('pickChatModel keeps routine short turns on the snappy chat tier', () => {
  for (const ask of [
    'hi',
    'why is this card red?', // the bare-"why" regression must stay on chat
    "what's my next step?",
    'open the pipeline',
    'thanks!'
  ]) {
    assert.equal(pickChatModel(ask), AI_MODELS.chat, `expected chat tier for: ${ask}`);
  }
});

test('pickChatModel does not false-trigger on substrings of analytical words', () => {
  // "whyever" / "modeled" must not match the \b-bounded markers.
  assert.equal(pickChatModel('whyever did that happen'), AI_MODELS.chat);
  assert.equal(pickChatModel('he modeled clay as a kid'), AI_MODELS.chat);
});

test('pickChatModel honours the EARN_AUTO_REASONING=0 kill switch', () => {
  const prev = process.env.EARN_AUTO_REASONING;
  process.env.EARN_AUTO_REASONING = '0';
  try {
    assert.equal(pickChatModel('Analyze the downside scenario in detail'), AI_MODELS.chat);
  } finally {
    if (prev === undefined) delete process.env.EARN_AUTO_REASONING;
    else process.env.EARN_AUTO_REASONING = prev;
  }
});

test('pickChatModel handles empty / whitespace input safely', () => {
  assert.equal(pickChatModel(''), AI_MODELS.chat);
  assert.equal(pickChatModel('   '), AI_MODELS.chat);
});

test('earnToolMode: navigate auto-runs, mutating tools require confirmation', () => {
  assert.equal(earnToolMode('navigate'), 'auto');
  assert.equal(earnToolMode('create_deal'), 'confirm');
  assert.equal(earnToolMode('run_diligence'), 'confirm');
  // Unknown / future tools default to the safe side: confirm.
  assert.equal(earnToolMode('delete_everything'), 'confirm');
});

test('EARN_NAV_DESTINATIONS are all absolute in-app paths and include core surfaces', () => {
  assert.ok(EARN_NAV_DESTINATIONS.length > 0);
  for (const dest of EARN_NAV_DESTINATIONS) {
    assert.match(dest, /^\/[a-z-]/, `destination must be an absolute path: ${dest}`);
  }
  const all: readonly string[] = EARN_NAV_DESTINATIONS;
  for (const core of ['/pipeline', '/command-center', '/diligence']) {
    assert.ok(all.includes(core), `missing core destination: ${core}`);
  }
});
