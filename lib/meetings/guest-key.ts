// lib/meetings/guest-key.ts
// The identity a joiner knocks with at a meeting's waiting room.
//
// This used to be a fresh `crypto.randomUUID()` per page load, which quietly
// broke the waiting room in both directions.
//
// A guest who reloaded — the obvious thing to do when a screen has said
// "waiting" for a while — knocked again under a new key. The host saw the same
// person listed twice, and admitting the first row reached nobody: the guest was
// polling the other key, so they went on waiting while the host believed they
// had let them in. And a deny lasted exactly as long as it took the denied guest
// to press reload.
//
// One person is one key, so an admit lands on the row they are actually polling
// and a deny stays a deny. The scope is deliberately `localStorage` rather than
// the session: a second tab is the other easy way around a deny, and a knock is
// about the person, not the tab. The WebRTC peer id stays per-tab — see
// `myIdRef` in MeetingRoom — because that one really does identify a connection.

/** Where a room's guest key is kept. Namespaced per room: codes are per-meeting. */
export function guestKeyStorageKey(roomCode: string): string {
  return `fx_guest_key_${roomCode}`;
}

/** The subset of the Storage API this needs, so it can be tested without a DOM. */
export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The stored key for this room, or `fresh` — stored for next time.
 *
 * Storage is allowed to be missing entirely (server render) and allowed to throw
 * on both reads and writes (Safari private mode, cookie-blocking settings). None
 * of that may stop somebody joining a meeting, so every failure falls back to the
 * one-off key: a guest with unusable storage is exactly as well off as they were
 * before, rather than unable to knock at all.
 */
export function resolveGuestKey(roomCode: string, fresh: string, store: KeyStore | null | undefined): string {
  if (!store) return fresh;
  const storageKey = guestKeyStorageKey(roomCode);
  try {
    const existing = store.getItem(storageKey);
    if (existing) return existing;
  } catch {
    // Reads can throw outright; a fresh key still gets them in.
    return fresh;
  }
  try { store.setItem(storageKey, fresh); } catch { /* not persisted; still usable now */ }
  return fresh;
}
