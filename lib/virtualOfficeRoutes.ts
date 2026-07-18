/**
 * Centralized route table for the **Virtual Office** (formerly "Command
 * Center"). Import these constants instead of hardcoding path strings, so the
 * rename can't drift and the planned nested surfaces (Character Studio, Space
 * Editor, Members, Rooms, Settings) all resolve from one source of truth.
 *
 * The legacy `/command-center` paths permanently redirect to `/virtual-office`
 * (see `next.config.mjs`), preserving nested segments and query strings — so
 * existing bookmarks, deep links, and invite URLs keep working.
 *
 * "Command Center" survives as the name of the operational dashboard *inside*
 * the Virtual Office (`commandCenter` below), no longer the umbrella route.
 */
export const virtualOfficeRoutes = {
  /** The live 2.5D office — the primary interactive workspace. */
  root: "/virtual-office",
  /** Operational dashboard surface hosted inside the Virtual Office. */
  commandCenter: "/virtual-office/command-center",
  /** Raster pixel-art character + map studio (replaces the vector avatar). */
  pixelStudio: "/virtual-office/pixel-studio",
  pixelMapStudio: "/virtual-office/pixel-studio/map",
  /** People + AI-executive avatar configuration. */
  characterStudio: "/virtual-office/character-studio",
  characterStudioNew: "/virtual-office/character-studio/new",
  characterStudioFromPhoto: "/virtual-office/character-studio/create-from-photo",
  characterStudioManual: "/virtual-office/character-studio/create-manually",
  characterStudioLibrary: "/virtual-office/character-studio/library",
  /** Environment / space design. */
  spaceEditor: "/virtual-office/space-editor",
  spaceEditorNew: "/virtual-office/space-editor/new",
  spaceEditorTemplates: "/virtual-office/space-editor/templates",
  /** Office administration surfaces. */
  members: "/virtual-office/members",
  rooms: "/virtual-office/rooms",
  settings: "/virtual-office/settings",
} as const;

/** The legacy prefix that redirects into {@link virtualOfficeRoutes.root}. */
export const LEGACY_VIRTUAL_OFFICE_PREFIX = "/command-center";

/**
 * Resolve a legacy `/command-center[...]` path to its canonical Virtual Office
 * destination, preserving nested segments and the query string. Returns `null`
 * for any path that isn't under the legacy prefix.
 *
 * This is the pure mirror of the two redirect rules in `next.config.mjs`
 * (`/command-center` and `/command-center/:path*`), kept here so the mapping is
 * unit-testable and the runtime redirect and app code can't drift.
 */
export function legacyToVirtualOffice(pathAndQuery: string): string | null {
  const hashIndex = pathAndQuery.indexOf("#");
  const hash = hashIndex >= 0 ? pathAndQuery.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? pathAndQuery.slice(0, hashIndex) : pathAndQuery;
  const qIndex = withoutHash.indexOf("?");
  const path = qIndex >= 0 ? withoutHash.slice(0, qIndex) : withoutHash;
  const query = qIndex >= 0 ? withoutHash.slice(qIndex) : "";

  const isBare = path === LEGACY_VIRTUAL_OFFICE_PREFIX;
  const isNested = path.startsWith(`${LEGACY_VIRTUAL_OFFICE_PREFIX}/`);
  if (!isBare && !isNested) return null;

  const rest = path.slice(LEGACY_VIRTUAL_OFFICE_PREFIX.length); // "" or "/sub/path"
  return `${virtualOfficeRoutes.root}${rest}${query}${hash}`;
}

/** A Character Studio editor route for a specific avatar. */
export function characterStudioAvatar(avatarId: string): string {
  return `${virtualOfficeRoutes.characterStudio}/${avatarId}`;
}

/** A Space Editor route for a specific space. */
export function spaceEditorSpace(spaceId: string): string {
  return `${virtualOfficeRoutes.spaceEditor}/${spaceId}`;
}
