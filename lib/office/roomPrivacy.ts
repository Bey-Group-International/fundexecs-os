/**
 * FundExecs OS — room privacy (Spot-style private / knock-to-join rooms).
 *
 * A client-native "make this room private" mechanic: an operator can mark the
 * room they're standing in as private (a do-not-disturb / locked session). A
 * private room shows a lock badge on the floor, and when another person's
 * avatar walks into it they "knock" — announced to the floor feed and to the
 * occupant — rather than silently barging in.
 *
 * This module owns the pure, framework-free state: which room keys are private,
 * persisted to localStorage, plus the small announcement-string helpers. The
 * core is dependency-free so it unit-tests in a Node environment; only the
 * load/save helpers touch a `Storage`, and they accept one so tests can inject
 * an in-memory stub. Saving emits a window event the scene/VOG react to live.
 */

/** localStorage key the private-room set is persisted under. */
export const ROOM_PRIVACY_KEY = "office:private-rooms";

/** Window event emitted after a change, so the scene can re-render live. */
export const ROOM_PRIVACY_EVENT = "office:room-privacy-changed";

/** Minimal storage surface — `window.localStorage` satisfies it, as does a stub. */
export type PrivacyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Parse a persisted payload (string | null) into a clean set of room keys. Pure. */
export function parsePrivateRooms(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is string => typeof k === "string" && k.length > 0));
  } catch {
    return new Set();
  }
}

/** Serialize a private-room set to its persisted form. Pure. */
export function serializePrivateRooms(rooms: Set<string>): string {
  return JSON.stringify([...rooms]);
}

/** Resolve a storage: an explicit stub (tests) or `window.localStorage`, or null. */
function resolveStorage(explicit?: PrivacyStorage): PrivacyStorage | null {
  if (explicit) return explicit;
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return null;
}

/** Load the persisted set of private room keys. */
export function loadPrivateRooms(storage?: PrivacyStorage): Set<string> {
  const store = resolveStorage(storage);
  if (!store) return new Set();
  return parsePrivateRooms(store.getItem(ROOM_PRIVACY_KEY));
}

/** Whether a given room key is currently private. */
export function isRoomPrivate(roomKey: string, storage?: PrivacyStorage): boolean {
  if (!roomKey) return false;
  return loadPrivateRooms(storage).has(roomKey);
}

/** Persist the full private-room set and emit the change event. */
function save(rooms: Set<string>, storage?: PrivacyStorage): void {
  const store = resolveStorage(storage);
  if (store) store.setItem(ROOM_PRIVACY_KEY, serializePrivateRooms(rooms));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(ROOM_PRIVACY_EVENT, { detail: [...rooms] }));
  }
}

/** Mark a room private (or not). Returns the updated set. */
export function setRoomPrivate(roomKey: string, isPrivate: boolean, storage?: PrivacyStorage): Set<string> {
  const rooms = loadPrivateRooms(storage);
  if (!roomKey) return rooms;
  if (isPrivate) rooms.add(roomKey);
  else rooms.delete(roomKey);
  save(rooms, storage);
  return rooms;
}

/** Flip a room's privacy. Returns the new privacy state (`true` = now private). */
export function togglePrivateRoom(roomKey: string, storage?: PrivacyStorage): boolean {
  const nowPrivate = !isRoomPrivate(roomKey, storage);
  setRoomPrivate(roomKey, nowPrivate, storage);
  return nowPrivate;
}

/** Feed line announcing a room's privacy change. Pure. */
export function privacyAnnouncement(roomLabel: string, isPrivate: boolean): string {
  return isPrivate
    ? `🔒 ${roomLabel} is now private`
    : `🔓 ${roomLabel} is open again`;
}

/** Feed / bubble line announcing a knock on a private room. Pure. */
export function knockAnnouncement(visitorName: string, roomLabel: string): string {
  const who = visitorName.trim() || "Someone";
  return `🔔 ${who} knocked on ${roomLabel}`;
}
