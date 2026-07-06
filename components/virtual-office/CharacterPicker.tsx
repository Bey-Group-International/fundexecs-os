"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PROGRAM_AGENTS,
  AGENT_BY_ID,
  type AgentId,
} from "@/components/virtual-office/program/officeProgram";
import { agentAvatarSpec } from "@/components/virtual-office/avatar/avatarPalette";
import { AvatarPreview } from "@/components/virtual-office/avatar/AvatarPreview";

export const CHARACTER_STORAGE_KEY = "fx-office-character";
const DEFAULT_CHARACTER_ID: AgentId = "earn";

/** The selectable roster is the floor's executive team (single source of truth). */
function isAgentId(id: string): id is AgentId {
  return id in AGENT_BY_ID;
}

/** The vector avatar spec for a floor executive (the coin for Earn). */
function specFor(agentId: AgentId) {
  return agentAvatarSpec(agentId, AGENT_BY_ID[agentId].accent);
}

/**
 * Persisted character selection, stored under "fx-office-character". The value
 * is a floor-executive agent id (e.g. "earn", "analyst"); legacy/unknown values
 * fall back to Earn. Returns [characterId, setCharacterId].
 */
export function useCharacterSelection(): [string, (id: string) => void] {
  const [characterId, setCharacterIdState] = useState<string>(DEFAULT_CHARACTER_ID);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CHARACTER_STORAGE_KEY);
      if (stored && isAgentId(stored)) {
        setCharacterIdState(stored);
      }
    } catch {
      // localStorage unavailable (private mode etc.) — keep default
    }
  }, []);

  const setCharacterId = useCallback((id: string) => {
    setCharacterIdState(id);
    try {
      window.localStorage.setItem(CHARACTER_STORAGE_KEY, id);
    } catch {
      // ignore persistence failures
    }
  }, []);

  return [characterId, setCharacterId];
}

/**
 * The full picker: choose which floor executive you appear as. Each option is a
 * live vector preview that matches the on-floor avatar exactly.
 */
export function CharacterPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      className="rounded-lg border p-3"
      style={{ background: "#0a0806", borderColor: "rgba(201, 168, 76, 0.35)" }}
    >
      <p
        className="mb-2 text-[11px] uppercase tracking-[0.2em]"
        style={{ color: "#c9a84c", fontFamily: "Georgia, 'Times New Roman', serif" }}
      >
        Choose your executive
      </p>
      <div className="flex flex-wrap gap-2">
        {PROGRAM_AGENTS.map((agent) => {
          const selected = agent.id === selectedId;
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => onSelect(agent.id)}
              aria-pressed={selected}
              title={`${agent.name} — ${agent.role}`}
              className="flex w-[92px] flex-col items-center gap-1.5 rounded-md border px-2 pb-2 pt-2.5 transition-colors"
              style={{
                background: selected ? "rgba(201, 168, 76, 0.08)" : "transparent",
                borderColor: selected ? agent.accent : "rgba(201, 168, 76, 0.2)",
                borderWidth: selected ? 2 : 1,
                boxShadow: selected ? `0 0 0 1px ${agent.accent}55` : "none",
              }}
            >
              <AvatarPreview spec={specFor(agent.id)} size={52} />
              <span
                className="text-center text-[10px] leading-tight"
                style={{
                  color: selected ? agent.accent : "#c9a84c",
                  fontFamily: "Georgia, 'Times New Roman', serif",
                }}
              >
                {agent.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Compact current-character control for the office header: shows the selected
 * executive's vector avatar + name as a chip, and opens the full CharacterPicker
 * in a dropdown popover. Sits inline on one line beside the office-data metrics.
 */
export function CharacterChip({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const agentId: AgentId = isAgentId(selectedId) ? selectedId : DEFAULT_CHARACTER_ID;
  const agent = AGENT_BY_ID[agentId];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Current character: ${agent.name}. Change character.`}
        className="flex items-center gap-2 rounded-xl border px-2.5 py-1.5 transition-colors"
        style={{
          background: "rgba(10, 8, 6, 0.7)",
          borderColor: open ? agent.accent : "rgba(201, 168, 76, 0.35)",
        }}
      >
        <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-md" style={{ background: "#0a0806" }}>
          <AvatarPreview spec={specFor(agentId)} size={28} />
        </span>
        <span className="flex flex-col items-start leading-tight">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-muted">Character</span>
          <span className="text-sm font-semibold text-fg-primary">{agent.name}</span>
        </span>
        <span aria-hidden className="ml-0.5 text-[10px] text-fg-muted transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }}>
          ▾
        </span>
      </button>
      {open ? (
        <>
          {/* Click-away backdrop */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-max max-w-[340px]">
            <CharacterPicker
              selectedId={selectedId}
              onSelect={(id) => {
                onSelect(id);
                setOpen(false);
              }}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
