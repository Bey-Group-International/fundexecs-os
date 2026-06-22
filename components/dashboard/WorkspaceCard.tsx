import Link from "next/link";
import type { WorkspaceConfig } from "@/lib/dashboard/types";
import { characterById } from "@/components/characters/characterConfig";
import { ExecutiveSprite } from "@/components/characters/ExecutiveSprite";

export function WorkspaceCard({ workspace }: { workspace: WorkspaceConfig }) {
  const character = characterById(workspace.characterId);
  return (
    <Link
      href={workspace.href}
      className="fx-card fx-card-hover group flex min-h-[180px] flex-col justify-between overflow-hidden p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
            {workspace.eyebrow}
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold text-fg-primary">
            {workspace.title}
          </h2>
        </div>
        <ExecutiveSprite character={character} size="sm" state="idle" />
      </div>
      <p className="mt-4 text-sm leading-6 text-fg-secondary">{workspace.description}</p>
      <span className="mt-4 font-mono text-[10px] uppercase tracking-wider text-gold-400 transition group-hover:translate-x-1">
        Open workspace →
      </span>
    </Link>
  );
}
