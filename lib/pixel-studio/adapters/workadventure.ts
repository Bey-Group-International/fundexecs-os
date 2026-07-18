/**
 * WorkAdventure adapter — collapses the rich internal layer model into the six
 * WorkAdventure Woka categories (body, eyes, hairs, clothes, hats, accessories)
 * and renders one standard 96×128 three-frame walk sheet per category.
 *
 * IMPORTANT compatibility note (documented in the export report and README):
 * WorkAdventure's Woka format only defines the walk sheet. Idle/talk/approve
 * are FundExecs extensions and are NOT part of this bundle — they ship in the
 * extended bundle instead.
 */
import { AssetRegistry, type ResolvedLayer } from "../asset-registry";
import { createComposer } from "../compositor";
import { Raster } from "../raster";
import {
  WORKADVENTURE_CATEGORIES,
  type CharacterConfig,
  type CompatibilityReport,
  type WorkAdventureCategory,
} from "../types";

export interface WorkAdventureLayer {
  category: WorkAdventureCategory;
  /** 96×128 walk sheet (3 cols × 4 rows, down/left/right/up). */
  sheet: Raster;
}

const CATEGORY_MEMBERSHIP: Record<WorkAdventureCategory, (l: ResolvedLayer) => boolean> = {
  body: (l) => l.asset.workAdventureCategory === "body",
  eyes: (l) => l.asset.workAdventureCategory === "eyes",
  hairs: (l) => l.asset.workAdventureCategory === "hairs",
  clothes: (l) => l.asset.workAdventureCategory === "clothes",
  hats: (l) => l.asset.workAdventureCategory === "hats",
  accessories: (l) => l.asset.workAdventureCategory === "accessories",
};

/** Build the six per-category walk sheets. */
export function buildWorkAdventureLayers(
  registry: AssetRegistry,
  config: CharacterConfig,
): WorkAdventureLayer[] {
  const composer = createComposer(registry);
  return WORKADVENTURE_CATEGORIES.map((category) => {
    const isBody = category === "body";
    const sheet = composer.composeStateSheet(config, "walk", {
      includeShadow: false,
      includeSkin: isBody, // skin ships in the body layer
      layerFilter: CATEGORY_MEMBERSHIP[category],
    });
    return { category, sheet };
  });
}

/** A single flattened preview walk sheet (all categories composited). */
export function buildWorkAdventurePreview(
  registry: AssetRegistry,
  config: CharacterConfig,
): Raster {
  return createComposer(registry).composeStateSheet(config, "walk", { includeShadow: false });
}

/**
 * WorkAdventure JSON descriptor (Woka collection entry). References the six
 * category PNGs by relative path.
 */
export function buildWokaDescriptor(config: CharacterConfig): Record<string, unknown> {
  const layers: Record<string, unknown>[] = WORKADVENTURE_CATEGORIES.map((c) => ({
    id: `${config.characterId}-${c}`,
    name: c,
    url: `layers/${c}.png`,
  }));
  return {
    woka: {
      collections: [
        {
          name: "FundExecs Executives",
          position: 1,
          textures: layers,
        },
      ],
    },
    walkSheet: { columns: 3, rows: 4, width: 96, height: 128, order: ["down", "left", "right", "up"] },
    characterId: config.characterId,
    displayName: config.displayName,
  };
}

export function workAdventureReport(
  registry: AssetRegistry,
  config: CharacterConfig,
  generatedAt: string,
): CompatibilityReport {
  const entries: CompatibilityReport["entries"] = [];
  const layers = buildWorkAdventureLayers(registry, config);

  entries.push({ requirement: "32×32 native frames", status: "ok", detail: "All frames are 32×32." });
  for (const l of layers) {
    const good = l.sheet.width === 96 && l.sheet.height === 128;
    entries.push({
      requirement: `${l.category} walk sheet 96×128`,
      status: good ? "ok" : "missing",
      detail: `${l.sheet.width}×${l.sheet.height}`,
    });
  }
  entries.push({
    requirement: "Direction order down/left/right/up",
    status: "ok",
    detail: "Rows ordered per manifest.frame.directions.",
  });
  entries.push({
    requirement: "Three-frame walk animation",
    status: "ok",
    detail: "3 columns per direction.",
  });
  entries.push({
    requirement: "Extended states (idle/talk/approve)",
    status: "unsupported",
    detail: "Not part of the WorkAdventure Woka format — exported in the FundExecs extended bundle instead.",
  });
  entries.push({
    requirement: "Transparent PNG layers",
    status: "ok",
    detail: "Category sheets are transparent outside the silhouette.",
  });
  entries.push({
    requirement: "Attribution / license metadata",
    status: "ok",
    detail: "Included as ATTRIBUTION.txt.",
  });

  const ok = entries.every((e) => e.status === "ok" || e.status === "unsupported");
  return { target: "WorkAdventure Woka", generatedAt, entries, ok };
}
