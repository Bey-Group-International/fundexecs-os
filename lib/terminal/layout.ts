// lib/terminal/layout.ts
// The pane-tree model for the terminal's configurable multi-pane workspace
// (System 1). Pure + dependency-free + fully tested: the React shell
// (components/terminal/TerminalShell) is a thin renderer over these operations,
// and terminal_layouts persists exactly what serializeLayout() produces.
//
// A layout is a binary-ish tree: SPLIT nodes divide space (row/column) among
// children with fractional sizes; LEAF nodes are the panes the user actually sees
// (a bound entity + pane type + the command that opened them). Every operation is
// a pure (layout, …) -> layout transform so it can be reduced in a client
// useReducer AND validated in tests without a DOM.
//
// IDs are supplied by the caller (the client generates crypto.randomUUID()); the
// module never invents randomness, which keeps it deterministic for tests.

/** The pane surfaces the terminal can host. Each maps to an existing FundExecs
 *  surface (a war room, the capital map, the portfolio cockpit, Copilot, …); the
 *  richer adapters are layered on in later increments. */
export type PaneType =
  | "deal"
  | "fund"
  | "lp"
  | "gp"
  | "company"
  | "person"
  | "portfolio"
  | "pipeline"
  | "watchlist"
  | "alerts"
  | "document"
  | "dataroom"
  | "relationship"
  | "analysis"
  | "copilot"
  | "blank";

export type SplitDirection = "row" | "column";

/** A visible pane. `entityId`/`entityLabel` bind it to a domain record; `command`
 *  records the command-bar input that opened it (for the audit trail + re-run). */
export interface LeafPane {
  kind: "leaf";
  id: string;
  paneType: PaneType;
  title: string;
  entityId?: string;
  entityLabel?: string;
  command?: string;
}

/** A split of space among children. `sizes` are fractions in [0,1] summing to ~1,
 *  one per child. */
export interface SplitPane {
  kind: "split";
  id: string;
  direction: SplitDirection;
  children: PaneNode[];
  sizes: number[];
}

export type PaneNode = LeafPane | SplitPane;

/** The bump-on-breaking-change guard for terminal_layouts.layout_version. Any
 *  persisted layout whose version differs is discarded (deserialize -> empty). */
export const LAYOUT_VERSION = 1;

export interface Layout {
  version: number;
  root: PaneNode | null;
  focusedPaneId: string | null;
}

// --- construction -----------------------------------------------------------

export function emptyLayout(): Layout {
  return { version: LAYOUT_VERSION, root: null, focusedPaneId: null };
}

export function makeLeaf(
  id: string,
  paneType: PaneType,
  opts: { title?: string; entityId?: string; entityLabel?: string; command?: string } = {},
): LeafPane {
  return {
    kind: "leaf",
    id,
    paneType,
    title: opts.title ?? defaultTitle(paneType, opts.entityLabel),
    entityId: opts.entityId,
    entityLabel: opts.entityLabel,
    command: opts.command,
  };
}

function defaultTitle(paneType: PaneType, entityLabel?: string): string {
  const base = PANE_TYPE_LABEL[paneType] ?? paneType;
  return entityLabel ? `${base}: ${entityLabel}` : base;
}

const PANE_TYPE_LABEL: Record<PaneType, string> = {
  deal: "Deal",
  fund: "Fund",
  lp: "Investor",
  gp: "Manager",
  company: "Company",
  person: "Person",
  portfolio: "Portfolio",
  pipeline: "Pipeline",
  watchlist: "Watchlist",
  alerts: "Alerts",
  document: "Documents",
  dataroom: "Data Room",
  relationship: "Relationship",
  analysis: "Analysis",
  copilot: "Earn",
  blank: "Blank",
};

// --- traversal --------------------------------------------------------------

/** All leaf panes, left-to-right / top-to-bottom. */
export function leaves(layout: Layout): LeafPane[] {
  const out: LeafPane[] = [];
  const walk = (n: PaneNode | null) => {
    if (!n) return;
    if (n.kind === "leaf") out.push(n);
    else n.children.forEach(walk);
  };
  walk(layout.root);
  return out;
}

export function findLeaf(layout: Layout, id: string): LeafPane | null {
  return leaves(layout).find((l) => l.id === id) ?? null;
}

export function paneCount(layout: Layout): number {
  return leaves(layout).length;
}

// --- mutation (pure; every op returns a new Layout) -------------------------

/**
 * Open a leaf. If the layout is empty it becomes the root. Otherwise it replaces
 * the focused pane in place (the command-bar default — "open here"), or, when no
 * pane is focused, splits the root so nothing is lost. The new pane is focused.
 */
export function openPane(layout: Layout, leaf: LeafPane, splitId?: string): Layout {
  if (!layout.root) {
    return { version: layout.version, root: leaf, focusedPaneId: leaf.id };
  }
  if (layout.focusedPaneId && findLeaf(layout, layout.focusedPaneId)) {
    return focusPane(replaceLeaf(layout, layout.focusedPaneId, leaf), leaf.id);
  }
  // No focus: split the whole tree so the existing panes survive.
  const root: SplitPane = {
    kind: "split",
    id: splitId ?? `${leaf.id}-root`,
    direction: "row",
    children: [layout.root, leaf],
    sizes: [0.6, 0.4],
  };
  return { version: layout.version, root, focusedPaneId: leaf.id };
}

/**
 * Split the pane `targetId` into two, placing `newLeaf` alongside it. `splitId` is
 * the id for the new split node. The new pane is focused.
 */
export function splitPane(
  layout: Layout,
  targetId: string,
  direction: SplitDirection,
  newLeaf: LeafPane,
  splitId: string,
): Layout {
  const replace = (n: PaneNode): PaneNode => {
    if (n.kind === "leaf") {
      if (n.id !== targetId) return n;
      return {
        kind: "split",
        id: splitId,
        direction,
        children: [n, newLeaf],
        sizes: [0.5, 0.5],
      } satisfies SplitPane;
    }
    return { ...n, children: n.children.map(replace) };
  };
  if (!layout.root) return layout;
  return focusPane({ ...layout, root: replace(layout.root) }, newLeaf.id);
}

/**
 * Remove the leaf `targetId`. A split left with a single child collapses into
 * that child. Removing the last pane yields an empty layout. Focus moves to the
 * first remaining leaf.
 */
export function closePane(layout: Layout, targetId: string): Layout {
  if (!layout.root) return layout;

  const prune = (n: PaneNode): PaneNode | null => {
    if (n.kind === "leaf") return n.id === targetId ? null : n;
    const kept: PaneNode[] = [];
    const keptSizes: number[] = [];
    n.children.forEach((child, i) => {
      const p = prune(child);
      if (p) {
        kept.push(p);
        keptSizes.push(n.sizes[i] ?? 1 / n.children.length);
      }
    });
    if (kept.length === 0) return null;
    if (kept.length === 1) return kept[0]; // collapse single-child split
    return { ...n, children: kept, sizes: normalize(keptSizes) };
  };

  const root = prune(layout.root);
  const nextFocus =
    layout.focusedPaneId === targetId
      ? null
      : layout.focusedPaneId;
  const focused = nextFocus ?? (root ? firstLeafId(root) : null);
  return { version: layout.version, root, focusedPaneId: focused };
}

/** Update a leaf in place (bind an entity, rename, re-associate a command). */
export function updateLeaf(
  layout: Layout,
  targetId: string,
  patch: Partial<Omit<LeafPane, "kind" | "id">>,
): Layout {
  const walk = (n: PaneNode): PaneNode => {
    if (n.kind === "leaf") return n.id === targetId ? { ...n, ...patch } : n;
    return { ...n, children: n.children.map(walk) };
  };
  if (!layout.root) return layout;
  return { ...layout, root: walk(layout.root) };
}

/** Replace the leaf `targetId` with `leaf`, preserving position. */
export function replaceLeaf(layout: Layout, targetId: string, leaf: LeafPane): Layout {
  const walk = (n: PaneNode): PaneNode => {
    if (n.kind === "leaf") return n.id === targetId ? leaf : n;
    return { ...n, children: n.children.map(walk) };
  };
  if (!layout.root) return layout;
  return { ...layout, root: walk(layout.root) };
}

/** The smallest fraction a pane may occupy — a floor honored EVEN after
 *  renormalization, so a pane can never be dragged to zero (and lost). */
export const MIN_PANE_FRACTION = 0.08;

/** Set the sizes of a split node, clamped so every pane keeps at least
 *  MIN_PANE_FRACTION and the sizes still sum to 1. */
export function resizeSplit(layout: Layout, splitId: string, sizes: number[]): Layout {
  const walk = (n: PaneNode): PaneNode => {
    if (n.kind === "leaf") return n;
    if (n.id === splitId && sizes.length === n.children.length) {
      return { ...n, sizes: clampSizes(sizes, MIN_PANE_FRACTION) };
    }
    return { ...n, children: n.children.map(walk) };
  };
  if (!layout.root) return layout;
  return { ...layout, root: walk(layout.root) };
}

export function focusPane(layout: Layout, targetId: string): Layout {
  if (!findLeaf(layout, targetId)) return layout;
  return { ...layout, focusedPaneId: targetId };
}

// --- helpers ----------------------------------------------------------------

function firstLeafId(n: PaneNode): string {
  return n.kind === "leaf" ? n.id : firstLeafId(n.children[0]);
}

function normalize(sizes: number[]): number[] {
  const sum = sizes.reduce((a, b) => a + b, 0);
  if (sum <= 0) return sizes.map(() => 1 / sizes.length);
  return sizes.map((s) => s / sum);
}

/**
 * Normalize `sizes` to sum to 1 while guaranteeing every entry is at least `min`.
 * Panes below the floor are lifted to it and the shortfall is borrowed
 * proportionally from panes that have room above the floor — so the floor holds
 * even after renormalization (plain normalize() alone can push a clamped value
 * back under it).
 */
function clampSizes(sizes: number[], min: number): number[] {
  const n = sizes.length;
  if (n === 0) return sizes;
  if (min * n >= 1) return sizes.map(() => 1 / n); // floor can't be satisfied → equalize
  let out = normalize(sizes.map((s) => (s > 0 ? s : min)));
  for (let iter = 0; iter < 8; iter++) {
    const deficit = out.map((s, i) => (s < min ? i : -1)).filter((i) => i >= 0);
    if (deficit.length === 0) break;
    let needed = 0;
    for (const i of deficit) {
      needed += min - out[i];
      out[i] = min;
    }
    const donors = out.map((s, i) => (s > min ? i : -1)).filter((i) => i >= 0);
    const pool = donors.reduce((a, i) => a + (out[i] - min), 0);
    if (pool <= 1e-9) break;
    for (const i of donors) out[i] -= needed * ((out[i] - min) / pool);
  }
  return out;
}

// --- presets ----------------------------------------------------------------

/** The default preset a new workspace opens with. Presets seed a starting pane
 *  arrangement; the user then splits/closes/rebinds freely. */
export type WorkspacePreset =
  | "deal_underwriting"
  | "fundraising"
  | "investor_relations"
  | "portfolio_monitoring"
  | "market_intelligence"
  | "executive_brief"
  | "custom";

/** Seed a layout for a preset. `id` builds deterministic node ids (`${id}:n`) so
 *  the same preset produces the same tree — important for tests and idempotent
 *  seeding. */
export function defaultLayoutForPreset(preset: WorkspacePreset, id = "seed"): Layout {
  const leaf = (n: number, type: PaneType) => makeLeaf(`${id}:${n}`, type);
  const split = (n: number, direction: SplitDirection, children: PaneNode[], sizes: number[]): SplitPane => ({
    kind: "split",
    id: `${id}:s${n}`,
    direction,
    children,
    sizes,
  });

  let root: PaneNode;
  switch (preset) {
    case "deal_underwriting":
      root = split(1, "row", [leaf(1, "pipeline"), split(2, "column", [leaf(2, "deal"), leaf(3, "analysis")], [0.6, 0.4])], [0.32, 0.68]);
      break;
    case "fundraising":
      root = split(1, "row", [leaf(1, "portfolio"), leaf(2, "lp")], [0.55, 0.45]);
      break;
    case "investor_relations":
      root = split(1, "row", [leaf(1, "lp"), split(2, "column", [leaf(2, "alerts"), leaf(3, "copilot")], [0.5, 0.5])], [0.6, 0.4]);
      break;
    case "portfolio_monitoring":
      root = split(1, "row", [leaf(1, "portfolio"), split(2, "column", [leaf(2, "alerts"), leaf(3, "watchlist")], [0.5, 0.5])], [0.62, 0.38]);
      break;
    case "market_intelligence":
      root = split(1, "row", [leaf(1, "watchlist"), leaf(2, "alerts")], [0.5, 0.5]);
      break;
    case "executive_brief":
      root = split(1, "column", [leaf(1, "alerts"), split(2, "row", [leaf(2, "portfolio"), leaf(3, "pipeline")], [0.5, 0.5])], [0.35, 0.65]);
      break;
    case "custom":
    default:
      root = leaf(1, "copilot");
      break;
  }
  return { version: LAYOUT_VERSION, root, focusedPaneId: firstLeafId(root) };
}

// --- serialization ----------------------------------------------------------

/** Serialize a layout to the plain JSON stored in terminal_layouts.layout. */
export function serializeLayout(layout: Layout): unknown {
  return { version: layout.version, root: layout.root, focusedPaneId: layout.focusedPaneId };
}

/**
 * Rebuild a layout from persisted JSON, tolerating anything. Returns an empty
 * layout when the payload is missing, malformed, or a version we don't recognize
 * (forward/backward safety — a stored layout never crashes the shell).
 */
export function deserializeLayout(json: unknown): Layout {
  if (!json || typeof json !== "object") return emptyLayout();
  const obj = json as Record<string, unknown>;
  if (obj.version !== LAYOUT_VERSION) return emptyLayout();
  const root = sanitizeNode(obj.root);
  const focus = typeof obj.focusedPaneId === "string" ? obj.focusedPaneId : null;
  const layout: Layout = { version: LAYOUT_VERSION, root, focusedPaneId: focus };
  // Drop a dangling focus id.
  if (focus && !findLeaf(layout, focus)) layout.focusedPaneId = root ? firstLeafId(root) : null;
  return layout;
}

const VALID_TYPES = new Set<PaneType>(Object.keys(PANE_TYPE_LABEL) as PaneType[]);

function sanitizeNode(n: unknown): PaneNode | null {
  if (!n || typeof n !== "object") return null;
  const obj = n as Record<string, unknown>;
  if (obj.kind === "leaf") {
    if (typeof obj.id !== "string") return null;
    const paneType = (VALID_TYPES.has(obj.paneType as PaneType) ? obj.paneType : "blank") as PaneType;
    return {
      kind: "leaf",
      id: obj.id,
      paneType,
      title: typeof obj.title === "string" ? obj.title : defaultTitle(paneType),
      entityId: typeof obj.entityId === "string" ? obj.entityId : undefined,
      entityLabel: typeof obj.entityLabel === "string" ? obj.entityLabel : undefined,
      command: typeof obj.command === "string" ? obj.command : undefined,
    };
  }
  if (obj.kind === "split") {
    if (typeof obj.id !== "string" || !Array.isArray(obj.children)) return null;
    const children = obj.children.map(sanitizeNode).filter((c): c is PaneNode => c != null);
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    const direction: SplitDirection = obj.direction === "column" ? "column" : "row";
    const rawSizes = Array.isArray(obj.sizes) ? (obj.sizes as unknown[]) : [];
    const sizes = normalize(
      children.map((_, i) => (typeof rawSizes[i] === "number" && rawSizes[i]! > 0 ? (rawSizes[i] as number) : 1 / children.length)),
    );
    return { kind: "split", id: obj.id, direction, children, sizes };
  }
  return null;
}
