import { ROOMS, ROOM_BY_KEY, type OfficeZone } from "./layout";
import { defaultZones, zoneAt, zonesContaining, zoneKey } from "./zones";

/** Is a zone fully inside its source room's bounds? */
function insideRoom(z: OfficeZone, roomKey: string): boolean {
  const room = ROOM_BY_KEY[roomKey];
  return (
    z.x >= room.x - 1e-9 &&
    z.y >= room.y - 1e-9 &&
    z.x + z.w <= room.x + room.w + 1e-9 &&
    z.y + z.h <= room.y + room.h + 1e-9
  );
}

/** Center point of a zone rectangle. */
function center(z: OfficeZone): { x: number; y: number } {
  return { x: z.x + z.w / 2, y: z.y + z.h / 2 };
}

describe("defaultZones", () => {
  const zones = defaultZones(ROOMS);

  it("covers reception, both pods, the lounge, the cafe, and one hub", () => {
    const kinds = zones.map((z) => z.kind);
    expect(kinds).toContain("spawn");
    expect(kinds).toContain("silent");
    expect(kinds).toContain("meeting");
    expect(kinds).toContain("social");
    expect(kinds).toContain("embed");

    // Reception → one spawn zone.
    expect(zones.filter((z) => z.kind === "spawn")).toHaveLength(1);
    // Two pods → two silent zones.
    expect(zones.filter((z) => z.kind === "silent")).toHaveLength(2);
    // Exactly one hub carries the whiteboard embed.
    expect(zones.filter((z) => z.kind === "embed")).toHaveLength(1);
  });

  it("gives the pods a quiet-zone label and the lounge an auto meeting", () => {
    const silent = zones.filter((z) => z.kind === "silent");
    for (const z of silent) expect(z.label).toBe("Focus — quiet zone");

    const meeting = zones.find((z) => z.kind === "meeting");
    expect(meeting?.label).toBe("Meeting room");
    expect(meeting?.trigger).toBe("auto");
  });

  it("wires the embed zone as an action-triggered Excalidraw board", () => {
    const embed = zones.find((z) => z.kind === "embed");
    expect(embed?.trigger).toBe("action");
    expect(embed?.label).toBe("Whiteboard — press to open");
    expect(embed?.payload?.url).toBe("https://excalidraw.com");
    expect(embed?.payload?.policy).toBe("clipboard-write");
  });

  it("places the embed zone in the build hub", () => {
    const embed = zones.find((z) => z.kind === "embed");
    expect(embed?.id).toBe("zone-embed-build");
    expect(insideRoom(embed!, "build")).toBe(true);
  });

  it("keeps every zone inside its room and gives it a unique id", () => {
    const bySource: Record<string, string> = {
      "zone-spawn-reception": "reception",
      "zone-silent-pod-1": "pod-1",
      "zone-silent-pod-2": "pod-2",
      "zone-meeting-lounge": "lounge",
      "zone-social-cafe": "cafe",
      "zone-embed-build": "build",
    };
    for (const z of zones) {
      expect(insideRoom(z, bySource[z.id])).toBe(true);
    }
    const ids = zones.map((z) => z.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts the spawn zone over the reception's lower area", () => {
    const spawn = zones.find((z) => z.kind === "spawn")!;
    const reception = ROOM_BY_KEY.reception;
    // Its top edge sits at or below the room's vertical midpoint.
    expect(spawn.y).toBeGreaterThanOrEqual(reception.y + reception.h / 2 - 1e-9);
    expect(spawn.y + spawn.h).toBeCloseTo(reception.y + reception.h);
  });

  it("is deterministic — same rooms in, identical zones out", () => {
    expect(defaultZones(ROOMS)).toEqual(defaultZones(ROOMS));
  });

  it("produces no zones for a layout with none of the zoned room types", () => {
    const bare = ROOMS.filter((r) => r.type === "commons" || r.type === "hub");
    // Hubs still get the embed, but nothing else fires.
    const z = defaultZones(bare.filter((r) => r.type === "commons"));
    expect(z).toEqual([]);
  });
});

describe("zoneAt / zonesContaining", () => {
  const zones = defaultZones(ROOMS);

  it("finds the zone under a point inside a pod", () => {
    const pod = ROOM_BY_KEY["pod-1"];
    const hit = zoneAt({ x: pod.x + pod.w / 2, y: pod.y + pod.h / 2 }, zones);
    expect(hit?.kind).toBe("silent");
    expect(hit?.id).toBe("zone-silent-pod-1");
  });

  it("returns null for a point in an unzoned corridor", () => {
    // A point in the central corridor, inside no zoned room.
    expect(zoneAt({ x: 16, y: 13 }, zones)).toBeNull();
  });

  it("lets a later (more specific) zone win at overlapping points", () => {
    const build = ROOM_BY_KEY.build;
    const embed = zones.find((z) => z.kind === "embed")!;
    const p = center(embed);
    // The embed is the topmost zone at its center.
    expect(zoneAt(p, zones)?.kind).toBe("embed");
    // Sanity: the point really is inside the build hub.
    expect(p.x).toBeGreaterThan(build.x);
    expect(p.x).toBeLessThan(build.x + build.w);
  });

  it("zonesContaining lists every zone under a point", () => {
    const embed = zones.find((z) => z.kind === "embed")!;
    const all = zonesContaining(center(embed), zones);
    expect(all.map((z) => z.kind)).toContain("embed");
  });

  it("misses a point outside every zone", () => {
    expect(zonesContaining({ x: 16, y: 13 }, zones)).toEqual([]);
  });
});

describe("zoneKey", () => {
  it("is stable and unique per zone position", () => {
    const zones = defaultZones(ROOMS);
    const keys = zones.map(zoneKey);
    expect(new Set(keys).size).toBe(keys.length);
    // Deterministic for the same zone.
    expect(zoneKey(zones[0])).toBe(zoneKey(zones[0]));
  });
});
