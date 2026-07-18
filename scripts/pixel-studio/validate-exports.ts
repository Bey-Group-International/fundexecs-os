/**
 * npm run validate:exports
 *
 * Generates each bundle type in-memory and asserts the required files are
 * present and internally consistent, then round-trips a map through Tiled export
 * + import to prove collision, spawn, and layer metadata survive. Build-gating:
 * exits non-zero on any critical failure.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AssetRegistry } from "../../lib/pixel-studio/asset-registry";
import { buildManifest } from "../../lib/pixel-studio/manifest-build";
import { encodePng } from "../../lib/pixel-studio/node/png";
import { Raster } from "../../lib/pixel-studio/raster";
import {
  exportExtendedBundle,
  exportMapBundle,
  exportWorkAdventureBundle,
} from "../../lib/pixel-studio/export-service";
import { fromTiled, toTiled } from "../../lib/pixel-studio/adapters/tiled";
import { templateOpenOffice } from "../../lib/pixel-studio/map/map-project";
import { listZip } from "../../lib/pixel-studio/zip-read";

const enc = (r: Raster) => encodePng(r);
const AT = "2026-01-01T00:00:00.000Z";

const manifest = buildManifest();
const registry = new AssetRegistry(manifest);
const example = manifest.examples[0];

let critical = 0;
const fail = (msg: string) => {
  console.error(`  ✖ ${msg}`);
  critical++;
};
const ok = (msg: string) => console.log(`  ✔ ${msg}`);

function requirePaths(zip: Uint8Array, required: string[], label: string): void {
  const names = new Set(listZip(zip).map((e) => e.path));
  for (const r of required) {
    if (![...names].some((n) => n === r || n.endsWith(r))) fail(`${label}: missing ${r}`);
  }
  if (critical === 0) ok(`${label}: ${names.size} files, all required present`);
}

async function main(): Promise<void> {
console.log("WorkAdventure bundle:");
const wa = await exportWorkAdventureBundle(registry, example, enc, AT);
requirePaths(
  wa.zip,
  ["layers/body.png", "layers/eyes.png", "layers/hairs.png", "layers/clothes.png", "layers/hats.png", "layers/accessories.png", "character.json", "woka.json", "compatibility-report.json", "ATTRIBUTION.txt"],
  "WA",
);
if (!wa.report.ok) fail("WA compatibility report not ok");

console.log("Extended bundle:");
const ext = await exportExtendedBundle(registry, example, enc, AT);
requirePaths(
  ext.zip,
  ["native/" + example.characterId + "_idle_1x.png", "native/" + example.characterId + "_walk_1x.png", "native/" + example.characterId + "_talk_1x.png", "native/" + example.characterId + "_approve_1x.png", "review-8x/" + example.characterId + "_walk_8x.png", "manifest.json", "character.json", "pbr-showcase/materials.json", "README.md"],
  "Extended",
);

console.log("Map bundle:");
const project = templateOpenOffice();
const map = await exportMapBundle(project, enc, AT);
requirePaths(map.zip, [project.mapId + ".tmj", "tileset.png", "preview.png", "map-assets.json", "compatibility-report.json", "pbr-sidecar.json"], "Map");
if (!map.report.ok) fail("Map compatibility report not ok");

console.log("Tiled round-trip:");
const tiled = toTiled(project);
const back = fromTiled(tiled);
const collideBefore = project.layers.find((l) => l.id === "collisions")!.placements.length;
const collideAfter = back.layers.find((l) => l.id === "collisions")!.placements.length;
const spawnBefore = project.layers.find((l) => l.id === "spawns")!.placements.length;
const spawnAfter = back.layers.find((l) => l.id === "spawns")!.placements.length;
if (collideAfter !== collideBefore) fail(`collision cells changed: ${collideBefore} → ${collideAfter}`);
else ok(`collision cells preserved (${collideAfter})`);
if (spawnAfter < spawnBefore) fail(`spawn points lost: ${spawnBefore} → ${spawnAfter}`);
else ok(`spawn points preserved (${spawnAfter})`);
if (back.width !== project.width || back.height !== project.height) fail("dimensions changed on round-trip");
else ok(`dimensions preserved (${back.width}×${back.height})`);
if (!tiled.layers.some((l) => l.name === "floorLayer")) fail("floorLayer missing");
else ok("floorLayer present");

if (critical > 0) {
  console.error(`\n✖ validate:exports FAILED with ${critical} error(s).`);
  process.exit(1);
}
console.log("\n✔ validate:exports passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
