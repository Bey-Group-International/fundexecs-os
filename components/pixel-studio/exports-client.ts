"use client";

/**
 * Browser export helpers — wire the isomorphic export service to the canvas PNG
 * encoder and trigger downloads. All bundle assembly is shared with the headless
 * scripts; only the PNG encoder differs (canvas.toBlob here, zlib in Node).
 */
import { AssetRegistry } from "@/lib/pixel-studio/asset-registry";
import { rasterToPngBytes } from "@/lib/pixel-studio/canvas";
import {
  exportExtendedBundle,
  exportMapBundle,
  exportWorkAdventureBundle,
} from "@/lib/pixel-studio/export-service";
import type { CharacterConfig, MapProject } from "@/lib/pixel-studio/types";

const enc = (r: Parameters<typeof rasterToPngBytes>[0]) => rasterToPngBytes(r);

function download(bytes: Uint8Array, filename: string, mime = "application/zip"): void {
  // Copy into a fresh ArrayBuffer-backed view so the BlobPart type is satisfied
  // regardless of the source buffer kind.
  const part = new Uint8Array(bytes);
  const blob = new Blob([part], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, mime = "application/json"): void {
  download(new TextEncoder().encode(text), filename, mime);
}

export async function downloadWorkAdventure(registry: AssetRegistry, config: CharacterConfig): Promise<void> {
  const { zip } = await exportWorkAdventureBundle(registry, config, enc, new Date().toISOString());
  download(zip, `${config.characterId}_workadventure.zip`);
}

export async function downloadExtended(registry: AssetRegistry, config: CharacterConfig): Promise<void> {
  const { zip } = await exportExtendedBundle(registry, config, enc, new Date().toISOString());
  download(zip, `${config.characterId}_fundexecs-extended.zip`);
}

export async function downloadMap(project: MapProject): Promise<void> {
  const { zip } = await exportMapBundle(project, enc, new Date().toISOString());
  download(zip, `${project.mapId}.zip`);
}
