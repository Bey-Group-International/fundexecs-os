import Link from "next/link";
import type { ExecutiveCharacter } from "./characterConfig";
import { ExecutiveSprite } from "./ExecutiveSprite";

export function ExecutiveDialoguePanel({
  character,
  recommendation,
  context,
}: {
  character: ExecutiveCharacter;
  recommendation: string;
  context: string;
}) {
  return (
    <aside className="fx-card relative overflow-hidden p-4">
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/80 to-transparent"
      />
      <div className="flex items-start gap-3">
        <ExecutiveSprite character={character} state="talk" size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-base font-semibold text-fg-primary">
              {character.name}
            </p>
            {character.nickname ? (
              <span className="rounded-full border border-gold-500/35 bg-gold-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
                {character.nickname}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            {character.role}
          </p>
          <p className="mt-3 text-sm leading-6 text-fg-secondary">{recommendation}</p>
          <div className="mt-3 rounded-lg border border-line bg-surface-0/55 p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
              Boundary
            </p>
            <p className="mt-1 text-xs leading-5 text-fg-muted">{character.promptBoundary}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {character.workspaceHref ? (
              <Link
                href={character.workspaceHref}
                className="rounded-lg bg-gold-500 px-3 py-2 text-xs font-medium text-surface-0 transition hover:bg-gold-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300"
              >
                Open workspace
              </Link>
            ) : null}
            <Link
              href="/workspace"
              className="rounded-lg border border-line px-3 py-2 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
            >
              Create task
            </Link>
          </div>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            {context}
          </p>
        </div>
      </div>
    </aside>
  );
}
