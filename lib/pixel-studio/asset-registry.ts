/**
 * Asset registry — indexed, read-only view over a manifest's assets plus the
 * data-driven compatibility/occlusion engine.
 *
 * Compatibility logic lives HERE, driven entirely by asset metadata
 * (requires/excludes/occludes/fitGroups). UI components never hardcode "a hat
 * hides hair" — they ask the registry to resolve the active layer stack.
 */
import {
  type AssetCategory,
  type AssetDefinition,
  type CharacterConfig,
  type LayerSlot,
  type Manifest,
  type OutfitSystem,
} from "./types";

export interface ResolvedLayer {
  asset: AssetDefinition;
  /** Palette id actually used (config override → colorway → default). */
  paletteId: string;
  /** Material id actually used (config override → asset default). */
  materialId: string;
  slot: LayerSlot;
  zIndex: number;
}

export class AssetRegistry {
  readonly manifest: Manifest;
  private readonly byId = new Map<string, AssetDefinition>();
  private readonly byCategory = new Map<AssetCategory, AssetDefinition[]>();
  private readonly outfitById = new Map<string, OutfitSystem>();

  constructor(manifest: Manifest) {
    this.manifest = manifest;
    for (const asset of manifest.assets) {
      if (this.byId.has(asset.id)) throw new Error(`Duplicate asset id: ${asset.id}`);
      this.byId.set(asset.id, asset);
      const list = this.byCategory.get(asset.category) ?? [];
      list.push(asset);
      this.byCategory.set(asset.category, list);
    }
    for (const o of manifest.outfitSystems) this.outfitById.set(o.id, o);
  }

  get(id: string): AssetDefinition | undefined {
    return this.byId.get(id);
  }

  require(id: string): AssetDefinition {
    const a = this.byId.get(id);
    if (!a) throw new Error(`Unknown asset id: ${id}`);
    return a;
  }

  category(cat: AssetCategory): AssetDefinition[] {
    return this.byCategory.get(cat) ?? [];
  }

  outfit(id: string): OutfitSystem | undefined {
    return this.outfitById.get(id);
  }

  /** Assets in a category compatible with a fit group (universal always ok). */
  compatibleWith(cat: AssetCategory, fit: string): AssetDefinition[] {
    return this.category(cat).filter(
      (a) => a.fitGroups.includes("universal") || a.fitGroups.includes(fit as never),
    );
  }

  /**
   * Resolve a character config into the ordered, occlusion-filtered layer
   * stack ready for compositing. Order is by zIndex ascending (ties broken by
   * manifest layerOrder position, then asset id for determinism).
   */
  resolveLayers(config: CharacterConfig): ResolvedLayer[] {
    const active: AssetDefinition[] = [];
    const push = (id: string | null | undefined) => {
      if (!id) return;
      const a = this.byId.get(id);
      if (a) active.push(a);
    };

    // Body/face are implicit skin+face assets.
    push(config.face);
    push(`expression-${config.expression}`);
    push(config.hair);
    push(config.facialHair);
    push(config.headCovering);

    // Outfit sublayers.
    const outfit = this.outfitById.get(config.outfitSystem);
    if (outfit) for (const sub of outfit.sublayers) push(sub);

    for (const acc of config.accessories) push(acc);

    // Apply excludes: later-declared excludes win by removing the excluded id.
    // An asset never excludes itself (guards against inclusively-declared lists).
    const excluded = new Set<string>();
    for (const a of active) for (const ex of a.excludes) if (ex !== a.id) excluded.add(ex);
    let filtered = active.filter((a) => !excluded.has(a.id) && !excluded.has(a.category));

    // Compute occluded slots.
    const occludedSlots = new Set<LayerSlot>();
    for (const a of filtered) for (const slot of a.occludes) occludedSlots.add(slot);
    filtered = filtered.filter((a) => !occludedSlots.has(a.slot));

    const layerOrderIndex = new Map<string, number>();
    this.manifest.layerOrder.forEach((s, i) => layerOrderIndex.set(s, i));

    const resolved: ResolvedLayer[] = filtered.map((asset) => ({
      asset,
      paletteId: this.resolvePalette(config, asset, outfit),
      materialId: config.materialOverrides[asset.id]?.material ?? asset.materialId,
      slot: asset.slot,
      zIndex: asset.zIndex,
    }));

    resolved.sort((a, b) => {
      if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
      const la = layerOrderIndex.get(a.slot) ?? 999;
      const lb = layerOrderIndex.get(b.slot) ?? 999;
      if (la !== lb) return la - lb;
      return a.asset.id.localeCompare(b.asset.id);
    });

    return resolved;
  }

  private resolvePalette(
    config: CharacterConfig,
    asset: AssetDefinition,
    outfit: OutfitSystem | undefined,
  ): string {
    const override = config.materialOverrides[asset.id]?.palette;
    if (override) return override;

    switch (asset.paletteGroup) {
      case "skin":
        return config.skinPalette;
      case "hair":
        return asset.category === "facialHair" ? config.facialHairColor : config.hairColor;
      default:
        break;
    }

    // Outfit sublayers pull their palette from the selected colorway.
    if (outfit) {
      const colorway = outfit.colorways.find((c) => c.id === config.outfitColorway);
      const p = colorway?.palettes[asset.slot];
      if (p) return p;
    }

    return asset.defaultPalette ?? asset.paletteGroup;
  }

  /**
   * Validate a config against compatibility rules. Returns actionable issues
   * (empty = valid) rather than throwing, so the UI can surface warnings.
   */
  validateConfig(config: CharacterConfig): string[] {
    const issues: string[] = [];
    const ids = new Set<string>();
    const collect = (id: string | null) => id && ids.add(id);
    collect(config.face);
    collect(config.hair);
    collect(config.facialHair);
    collect(config.headCovering);
    for (const a of config.accessories) ids.add(a);

    for (const id of ids) {
      const asset = this.byId.get(id);
      if (!asset) {
        issues.push(`Unknown asset "${id}"`);
        continue;
      }
      for (const req of asset.requires) {
        const present =
          ids.has(req) ||
          config.outfitSystem === req ||
          config.expression === req ||
          [...ids].some((i) => this.byId.get(i)?.category === req);
        if (!present) issues.push(`"${asset.label}" requires "${req}"`);
      }
      for (const ex of asset.excludes) {
        if (ex !== asset.id && ids.has(ex)) {
          const other = this.byId.get(ex);
          issues.push(`"${asset.label}" excludes "${other?.label ?? ex}"`);
        }
      }
    }
    return issues;
  }
}
