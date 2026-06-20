import type { Entity } from "@/lib/supabase/database.types";

const TYPE_LABEL: Record<string, string> = {
  gp: "GP",
  management_co: "Management Co.",
  fund: "Fund",
  spv: "SPV",
  holdco: "Holdco",
  other: "Other",
};

type TreeNode = Entity & { children: TreeNode[] };

// Build a parent→children forest from a flat entity list.
// Roots = entities with no parent, or whose parent is not present in the set.
// Cycle guard: while walking up an entity's ancestry, if we revisit a node we
// already saw, we treat the entity as a root rather than nesting it (prevents
// infinite recursion from corrupt/cyclic parent_entity_id chains).
function buildForest(entities: Entity[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const e of entities) byId.set(e.id, { ...e, children: [] });

  // Detect whether following parent links from `id` ever loops back on itself.
  const hasCycle = (id: string): boolean => {
    const seen = new Set<string>();
    let cur: string | null = id;
    while (cur) {
      if (seen.has(cur)) return true;
      seen.add(cur);
      const node: TreeNode | undefined = byId.get(cur);
      cur = node?.parent_entity_id ?? null;
    }
    return false;
  };

  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.parent_entity_id;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent && !hasCycle(node.id)) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function formationYear(date: string | null): string | null {
  if (!date) return null;
  const year = date.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : null;
}

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const year = formationYear(node.formation_date);
  return (
    <li className="relative">
      {depth > 0 ? (
        // Connector lines: a vertical run plus an elbow into this node.
        <>
          <span className="absolute left-0 top-0 h-[18px] w-px bg-line" aria-hidden />
          <span className="absolute left-0 top-[18px] h-px w-3 bg-line" aria-hidden />
        </>
      ) : null}
      <div className={depth > 0 ? "flex items-center gap-2 pl-5 py-1" : "flex items-center gap-2 py-1"}>
        <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
          {TYPE_LABEL[node.entity_type] ?? node.entity_type}
        </span>
        <span className="text-sm text-fg-primary">{node.name}</span>
        {node.jurisdiction ? (
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{node.jurisdiction}</span>
        ) : null}
        {year ? <span className="font-mono text-[10px] text-fg-muted">· {year}</span> : null}
      </div>
      {node.children.length > 0 ? (
        <ul className="relative ml-3 border-l border-line pl-0">
          {node.children.map((child) => (
            <TreeRow key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

// Display-only hierarchy of the org's legal structure, server-rendered.
export function EntityTree({ entities }: { entities: Entity[] }) {
  const roots = buildForest(entities);
  if (roots.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border border-line bg-surface-1 p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Legal structure</div>
      <ul className="flex flex-col">
        {roots.map((node) => (
          <TreeRow key={node.id} node={node} depth={0} />
        ))}
      </ul>
    </div>
  );
}
