// Spatial meeting rooms — the bridge between the Virtual Office and the existing
// live-meetings call + notes pipeline.
//
// A room of type "meeting" is a *portal*: everyone standing inside it joins the
// same call, keyed off a deterministic room id derived from the org + room key.
// This module is pure and DOM-free so the geometry and id derivation are
// unit-testable and shared identically by every client (mirrors layout.ts).
import type { OfficeRoom } from "./layout";
import type { Participant } from "./presence";

/**
 * Deterministic, stable meeting-room id for an office room. Everyone who enters
 * the same spatial room derives the same id, so they all land in the same call
 * (the meetings service upserts on `room_code`, deduping concurrent creators).
 *
 * Kept URL/room-code safe (lowercase, only [a-z0-9-]) since it is used directly
 * as the `/meetings/<id>` route segment and the `live_meetings.room_code`.
 */
export function officeMeetingRoomId(orgId: string, roomKey: string): string {
  const safe = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return `office-${safe(orgId)}-${safe(roomKey)}`;
}

/**
 * Whether an office room is a meeting portal. Defensive on the optional `type`
 * field: a sibling change adds `type?: RoomType` to {@link OfficeRoom}, and it
 * may not be present yet — so we read it off a widened shape rather than the
 * declared type.
 */
export function isMeetingRoom(room: OfficeRoom): boolean {
  return (room as { type?: string }).type === "meeting";
}

/** Inclusive tile-space hit test against a room rectangle (matches layout.ts). */
function contains(room: OfficeRoom, x: number, y: number): boolean {
  return x >= room.x && x <= room.x + room.w && y >= room.y && y <= room.y + room.h;
}

/**
 * The human participants whose tile position falls inside the room's rectangle.
 * Agents are excluded — only people occupy a spatial meeting. Order is preserved
 * from the input list.
 */
export function roomOccupants(room: OfficeRoom, participants: Participant[]): Participant[] {
  return participants.filter((p) => p.kind === "human" && contains(room, p.x, p.y));
}
