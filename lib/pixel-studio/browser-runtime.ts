/**
 * Client-side runtime singletons. buildManifest() is deterministic and cheap
 * enough to run once per session; the registry and composer are memoized so
 * every studio component shares one instance.
 */
import { AssetRegistry } from "./asset-registry";
import { createComposer, type Composer } from "./compositor";
import { getManifest } from "./manifest";
import type { Manifest } from "./types";

let registry: AssetRegistry | null = null;
let composer: Composer | null = null;

export function manifest(): Manifest {
  return getManifest();
}

export function getRegistry(): AssetRegistry {
  if (!registry) registry = new AssetRegistry(getManifest());
  return registry;
}

export function getComposer(): Composer {
  if (!composer) composer = createComposer(getRegistry());
  return composer;
}
