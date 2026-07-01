"use client";

type BubbleOverlayProps = {
  /** Display names of everyone in the local player's current bubble (excluding self). */
  members: string[];
};

export function BubbleOverlay({ members }: BubbleOverlayProps) {
  if (members.length === 0) return null;

  return (
    <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 bg-slate-900/90 border border-emerald-500/30 rounded-lg px-3 py-1.5 pointer-events-none">
      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
      <span className="text-[11px] text-emerald-400 font-medium">
        {members.length === 1 ? "Nearby:" : "Group:"}
      </span>
      <span className="text-[11px] text-slate-300">
        {members.join(", ")}
      </span>
    </div>
  );
}
