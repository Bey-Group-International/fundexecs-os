"use client";

/**
 * FundExecs OS — 3D office shell.
 *
 * Wraps the native `Office3DView` (Three.js floor) with the office chrome that
 * is driven by the *program store* rather than the Phaser scene — so the 3D
 * office keeps the essential control surface the 2D office has: the status HUD,
 * the command console, the active-work panel, and the click-to-inspect agent
 * card. Those panels all read/write `officeProgramStore` (via `useOfficeProgram`
 * / `submitOfficeTask`), which the 3D view feeds identically, so they work with
 * no Phaser dependency.
 *
 * Proximity greeting cards now live in the 3D view itself (walk your avatar up
 * to an executive and they greet you). What is intentionally NOT here yet:
 * presence video tiles and meeting docks — those are produced by the Phaser
 * scene's live media/presence bridge, so they stay 2D-only until the 3D view
 * grows an equivalent. Hence the "Beta" marker in the renderer toggle.
 */

import { useCallback, useState } from "react";
import { Office3DView, type NpcClickPayload } from "./Office3DView";
import { OfficeHUD } from "./program/OfficeHUD";
import { OfficeCommandPanel } from "./program/OfficeCommandPanel";
import { ActiveWorkflowPanel } from "./program/ActiveWorkflowPanel";
import { AgentFloorInspector } from "./program/AgentFloorInspector";
import { AGENT_BY_ID, type AgentId } from "./program/officeProgram";

export function Office3DShell({
  active = true,
  onAskEarn,
}: {
  active?: boolean;
  /** Hand off to the Earn copilot, mirroring the Phaser office's onNpcClick. */
  onAskEarn?: (payload: NpcClickPayload) => void;
}) {
  const [inspectAgentId, setInspectAgentId] = useState<AgentId | null>(null);
  const [showCommand, setShowCommand] = useState(false);
  const [showWork, setShowWork] = useState(false);

  const handleNpc = useCallback((payload: NpcClickPayload) => {
    const id = payload.npcId.replace(/^agent:/, "") as AgentId;
    if (AGENT_BY_ID[id]) setInspectAgentId(id);
  }, []);

  const toolbarBtn =
    "rounded-md border border-line/60 bg-surface-0/85 px-2.5 py-1 text-[11px] font-semibold text-slate-300 backdrop-blur transition-colors hover:text-amber-300";

  return (
    <div className="flex w-full flex-col gap-3 xl:flex-row">
      <div className="relative min-h-[640px] flex-1 overflow-hidden rounded-2xl border border-line/60 bg-surface-0">
        {/* Status strip (program-store driven). */}
        <div className="absolute inset-x-0 top-0 z-10 p-2">
          <OfficeHUD currentRoom="" />
        </div>

        <Office3DView active={active} onNpcClick={handleNpc} />

        <span className="pointer-events-none absolute right-2 top-12 z-10 rounded bg-black/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gold-300">
          3D · Beta
        </span>

        {/* Floor toolbar: open the command console / active work. */}
        <div className="absolute bottom-2 left-2 z-10 flex gap-2">
          <button type="button" className={toolbarBtn} onClick={() => setShowCommand((v) => !v)} aria-pressed={showCommand}>
            Command
          </button>
          <button type="button" className={toolbarBtn} onClick={() => setShowWork((v) => !v)} aria-pressed={showWork}>
            Active Work
          </button>
        </div>

        {/* Click-to-inspect agent card. */}
        {inspectAgentId && (
          <AgentFloorInspector
            agentId={inspectAgentId}
            onAskEarn={() => {
              const meta = AGENT_BY_ID[inspectAgentId];
              onAskEarn?.({ npcId: `agent:${inspectAgentId}`, spriteKey: meta.spriteKey, name: meta.name });
            }}
            onClose={() => setInspectAgentId(null)}
          />
        )}
      </div>

      {/* Command & work column — mirrors the Phaser office's right rail. */}
      {(showCommand || showWork) && (
        <div className="flex w-full flex-col gap-3 xl:w-[340px] xl:shrink-0">
          {showCommand && (
            <div className="flex h-[430px] flex-col">
              <OfficeCommandPanel onDismiss={() => setShowCommand(false)} />
            </div>
          )}
          {showWork && <ActiveWorkflowPanel onDismiss={() => setShowWork(false)} />}
        </div>
      )}
    </div>
  );
}
