/**
 * npm run pixel:export
 *
 * Headlessly exports every example executive as both a WorkAdventure bundle and
 * a FundExecs extended bundle, plus the three map templates as map bundles, into
 * /exports. Demonstrates the export pipeline end-to-end without a browser.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AssetRegistry } from "../../lib/pixel-studio/asset-registry";
import { buildManifest } from "../../lib/pixel-studio/manifest-build";
import { encodePng } from "../../lib/pixel-studio/node/png";
import {
  exportExtendedBundle,
  exportMapBundle,
  exportWorkAdventureBundle,
} from "../../lib/pixel-studio/export-service";
import { TEMPLATES } from "../../lib/pixel-studio/map/map-project";
import { Raster } from "../../lib/pixel-studio/raster";

const enc = (r: Raster) => encodePng(r);
const AT = "2026-01-01T00:00:00.000Z";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const charDir = join(root, "exports", "characters");
const mapDir = join(root, "exports", "maps");
mkdirSync(charDir, { recursive: true });
mkdirSync(mapDir, { recursive: true });

const manifest = buildManifest();
const registry = new AssetRegistry(manifest);

async function main(): Promise<void> {
let count = 0;
for (const ex of manifest.examples) {
  const wa = await exportWorkAdventureBundle(registry, ex, enc, AT);
  writeFileSync(join(charDir, `${ex.characterId}_workadventure.zip`), wa.zip);
  const ext = await exportExtendedBundle(registry, ex, enc, AT);
  writeFileSync(join(charDir, `${ex.characterId}_fundexecs-extended.zip`), ext.zip);
  count += 2;
}

for (const t of TEMPLATES) {
  const project = t.build();
  const bundle = await exportMapBundle(project, enc, AT);
  writeFileSync(join(mapDir, `${t.id}.zip`), bundle.zip);
  count += 1;
}

console.log(`✔ Wrote ${count} export bundles to /exports`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
