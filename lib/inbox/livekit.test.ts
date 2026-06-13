import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { livekitConfigured, mintAccessToken, newRoomName } from './livekit';

/* ----------------------------------------------------------------------------
 * LiveKit token mint (pure, env-guarded).
 *
 * Locks the contract the in-app call actions depend on: no config -> feature
 * off (null token), and a minted token is a well-formed HS256 JWT carrying the
 * VideoGrant for the requested room.
 * --------------------------------------------------------------------------*/

const SAVED = {
  key: process.env.LIVEKIT_API_KEY,
  secret: process.env.LIVEKIT_API_SECRET,
  url: process.env.LIVEKIT_URL
};

afterEach(() => {
  process.env.LIVEKIT_API_KEY = SAVED.key;
  process.env.LIVEKIT_API_SECRET = SAVED.secret;
  process.env.LIVEKIT_URL = SAVED.url;
});

function decodeSegment(seg: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(seg, 'base64').toString('utf-8'));
}

test('mintAccessToken returns null when unconfigured', () => {
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;
  assert.equal(mintAccessToken({ identity: 'u1', room: 'r1' }), null);
});

test('livekitConfigured reflects env presence', () => {
  process.env.LIVEKIT_API_KEY = 'key';
  process.env.LIVEKIT_API_SECRET = 'secret';
  process.env.LIVEKIT_URL = 'wss://example.livekit.cloud';
  assert.equal(livekitConfigured(), true);

  delete process.env.LIVEKIT_URL;
  assert.equal(livekitConfigured(), false);
});

test('mintAccessToken signs a JWT with the video grant', () => {
  process.env.LIVEKIT_API_KEY = 'APIabc';
  process.env.LIVEKIT_API_SECRET = 'topsecret';

  const token = mintAccessToken({ identity: 'user-123', room: 'fx-room', name: 'Ada' });
  assert.ok(token, 'token minted');

  const [header, payload, signature] = token!.split('.');
  assert.ok(header && payload && signature, 'three JWT segments');

  assert.deepEqual(decodeSegment(header), { alg: 'HS256', typ: 'JWT' });

  const claims = decodeSegment(payload);
  assert.equal(claims.iss, 'APIabc');
  assert.equal(claims.sub, 'user-123');
  assert.equal(claims.name, 'Ada');
  const grant = claims.video as Record<string, unknown>;
  assert.equal(grant.room, 'fx-room');
  assert.equal(grant.roomJoin, true);
  assert.equal(grant.canPublish, true);
  assert.equal(grant.canSubscribe, true);
  assert.ok(typeof claims.exp === 'number' && (claims.exp as number) > (claims.iat as number));
});

test('newRoomName is unique-ish and prefixed', () => {
  const a = newRoomName();
  const b = newRoomName();
  assert.notEqual(a, b);
  assert.ok(a.startsWith('fx-'));
});
