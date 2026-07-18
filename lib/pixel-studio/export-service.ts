/**
 * Export service — assembles the three deterministic ZIP bundles:
 *   1. WorkAdventure character bundle (standard walk-sheet Woka layers)
 *   2. FundExecs extended character bundle (all states + PBR metadata)
 *   3. Map bundle (Tiled TMJ + tileset PNG + reports)
 *
 * Isomorphic: the caller injects a PNG encoder so this runs in the browser
 * (canvas.toBlob path) or headless (node PNG encoder). No Date.now() — bundles
 * are byte-stable for a given (config, timestamp) pair.
 */
import { AssetRegistry } from "./asset-registry";
import { createComposer } from "./compositor";
import { Raster } from "./raster";
import { makeZip, utf8, type ZipEntry } from "./zip";
import {
  buildWokaDescriptor,
  buildWorkAdventureLayers,
  buildWorkAdventurePreview,
  workAdventureReport,
} from "./adapters/workadventure";
import { toTiled, tiledReport } from "./adapters/tiled";
import { MAP_ASSETS } from "./map/map-assets";
import { renderMapPreview, renderTilesetAtlas } from "./map/map-compositor";
import {
  ANIMATION_STATES,
  WORKADVENTURE_CATEGORIES,
  type AnimationState,
  type CharacterConfig,
  type Manifest,
  type MapProject,
} from "./types";

export type PngEncoder = (raster: Raster) => Uint8Array | Promise<Uint8Array>;

async function png(entry: string, raster: Raster, enc: PngEncoder): Promise<ZipEntry> {
  return { path: entry, data: await enc(raster) };
}
function text(path: string, content: string): ZipEntry {
  return { path, data: utf8(content) };
}

const ATTRIBUTION_TEXT = (m: Manifest) =>
  [
    "FundExecs Pixel Character & Map Studio — Attribution",
    "",
    `Author: ${m.attribution.author}`,
    `License: ${m.attribution.license}`,
    `Copyright: ${m.attribution.copyright}`,
    "",
    m.attribution.notes,
    "",
    "WorkAdventure and Tiled are referenced for format compatibility only.",
    "No proprietary art, sprites, maps, or branding were copied from any product.",
  ].join("\n");

// ---------------------------------------------------------------------------
// WorkAdventure character bundle
// ---------------------------------------------------------------------------

export async function exportWorkAdventureBundle(
  registry: AssetRegistry,
  config: CharacterConfig,
  enc: PngEncoder,
  generatedAt: string,
): Promise<{ zip: Uint8Array; report: ReturnType<typeof workAdventureReport> }> {
  const files: ZipEntry[] = [];
  const layers = buildWorkAdventureLayers(registry, config);
  for (const l of layers) files.push(await png(`layers/${l.category}.png`, l.sheet, enc));

  files.push(await png("layers/preview.png", buildWorkAdventurePreview(registry, config).scaleNearest(4), enc));
  files.push(text("character.json", JSON.stringify(config, null, 2)));
  files.push(text("woka.json", JSON.stringify(buildWokaDescriptor(config), null, 2)));

  const report = workAdventureReport(registry, config, generatedAt);
  files.push(text("compatibility-report.json", JSON.stringify(report, null, 2)));
  files.push(text("ATTRIBUTION.txt", ATTRIBUTION_TEXT(registry.manifest)));
  files.push(
    text(
      "README.txt",
      [
        `WorkAdventure Woka bundle for ${config.displayName} (${config.characterId}).`,
        "",
        "Contains six category walk sheets (96×128, 3 frames × 4 directions).",
        "Direction order: down, left, right, up.",
        "",
        "NOTE: idle / talk / approve are NOT part of the WorkAdventure Woka",
        "format. Use the FundExecs extended bundle for those states.",
      ].join("\n"),
    ),
  );

  return { zip: makeZip(files), report };
}

// ---------------------------------------------------------------------------
// FundExecs extended character bundle
// ---------------------------------------------------------------------------

export async function exportExtendedBundle(
  registry: AssetRegistry,
  config: CharacterConfig,
  enc: PngEncoder,
  generatedAt: string,
): Promise<{ zip: Uint8Array }> {
  const m = registry.manifest;
  const composer = createComposer(registry);
  const files: ZipEntry[] = [];

  for (const state of ANIMATION_STATES as readonly AnimationState[]) {
    const native = composer.composeStateSheet(config, state);
    files.push(await png(`native/${config.characterId}_${state}_1x.png`, native, enc));
    files.push(await png(`review-8x/${config.characterId}_${state}_8x.png`, native.scaleNearest(8), enc));
  }

  // Per-WA-category walk layer breakdown.
  for (const category of WORKADVENTURE_CATEGORIES) {
    const sheet = composer.composeStateSheet(config, "walk", {
      includeShadow: false,
      includeSkin: category === "body",
      layerFilter: (l) => l.asset.workAdventureCategory === category,
    });
    files.push(await png(`native/layers/walk_${category}.png`, sheet, enc));
  }

  // PBR material metadata sidecar.
  const materials = registry
    .resolveLayers(config)
    .map((l) => ({ assetId: l.asset.id, materialId: l.materialId, material: m.materials[l.materialId] }));
  files.push(text("pbr-showcase/materials.json", JSON.stringify({ skin: m.materials.skin, layers: materials }, null, 2)));

  files.push(text("manifest.json", JSON.stringify(m, null, 2)));
  files.push(text("character.json", JSON.stringify(config, null, 2)));
  files.push(text("ATTRIBUTION.txt", ATTRIBUTION_TEXT(m)));
  files.push(
    text(
      "README.md",
      [
        `# FundExecs Extended Bundle — ${config.displayName}`,
        "",
        "Directory layout:",
        "- `native/` — 32px sprite sheets for idle, walk, talk, approve",
        "- `native/layers/` — per-WorkAdventure-category walk breakdown",
        "- `review-8x/` — exact 8× nearest-neighbor enlargements",
        "- `pbr-showcase/` — material metadata (PBR is a preview layer, not runtime art)",
        "",
        "Sheet dimensions (per manifest):",
        ...ANIMATION_STATES.map((s) => `- ${s}: ${m.animations[s].width}×${m.animations[s].height}`),
        "",
        "These extended states require FundExecs / custom runtime support;",
        "they are beyond the standard WorkAdventure Woka walk sheet.",
      ].join("\n"),
    ),
  );

  return { zip: makeZip(files) };
}

// ---------------------------------------------------------------------------
// Map bundle
// ---------------------------------------------------------------------------

export async function exportMapBundle(
  project: MapProject,
  enc: PngEncoder,
  generatedAt: string,
): Promise<{ zip: Uint8Array; report: ReturnType<typeof tiledReport> }> {
  const files: ZipEntry[] = [];
  const tiled = toTiled(project);
  files.push(text(`${project.mapId}.tmj`, JSON.stringify(tiled, null, 2)));
  files.push(await png("tileset.png", renderTilesetAtlas(MAP_ASSETS, project.branding), enc));
  files.push(await png("preview.png", renderMapPreview(project, false), enc));

  files.push(
    text(
      "map-assets.json",
      JSON.stringify(
        MAP_ASSETS.map((a) => ({ id: a.id, label: a.label, category: a.category, collides: a.collides, interaction: a.interaction, material: a.materialId })),
        null,
        2,
      ),
    ),
  );

  // PBR sidecar for map materials (preview-only; runtime tiles stay raster).
  files.push(
    text(
      "pbr-sidecar.json",
      JSON.stringify({ note: "Preview-only PBR metadata. Exported WA tiles remain raster.", assets: MAP_ASSETS.map((a) => ({ id: a.id, material: a.materialId })) }, null, 2),
    ),
  );

  const report = tiledReport(project, generatedAt);
  files.push(text("compatibility-report.json", JSON.stringify(report, null, 2)));
  files.push(
    text(
      "ATTRIBUTION.txt",
      [
        `Map: ${project.name}`,
        `Author: ${project.attribution.author}`,
        `License: ${project.attribution.license}`,
        `Copyright: ${project.attribution.copyright}`,
        "",
        "Original FundExecs tileset. Tiled/WorkAdventure referenced for format compatibility only.",
      ].join("\n"),
    ),
  );

  return { zip: makeZip(files), report };
}
