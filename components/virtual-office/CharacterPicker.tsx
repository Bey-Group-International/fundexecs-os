"use client";

import { useCallback, useEffect, useState } from "react";
import { executiveCharacters } from "@/components/characters/characterConfig";

export const CHARACTER_STORAGE_KEY = "fx-office-character";
const DEFAULT_CHARACTER_ID = "earnest-fundmaker";

/**
 * Frame dims + frames-per-row per sheet layout (row 0 frame 0 = idle-down).
 * earnest: 512px sheet / 32px frames = 16 cols; executive: 64px / 16px = 4.
 */
const SHEET_LAYOUT: Record<"earnest" | "executive", { w: number; h: number; cols: number }> = {
  earnest: { w: 32, h: 32, cols: 16 },
  executive: { w: 16, h: 32, cols: 4 },
};

const SHEET_ROWS = 5;

/**
 * Persisted character selection, stored under "fx-office-character".
 * Returns [characterId, setCharacterId]; defaults to "earnest-fundmaker".
 */
export function useCharacterSelection(): [string, (id: string) => void] {
  const [characterId, setCharacterIdState] = useState<string>(DEFAULT_CHARACTER_ID);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CHARACTER_STORAGE_KEY);
      if (stored && executiveCharacters.some((c) => c.id === stored)) {
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

function SpriteThumb({
  spriteSheet,
  frameMapKind,
  scale = 2,
}: {
  spriteSheet: string;
  frameMapKind: "earnest" | "executive";
  scale?: number;
}) {
  const { w, h, cols } = SHEET_LAYOUT[frameMapKind];
  return (
    <div
      aria-hidden
      style={{
        width: w * scale,
        height: h * scale,
        backgroundImage: `url(${spriteSheet})`,
        backgroundPosition: "0 0",
        backgroundRepeat: "no-repeat",
        backgroundSize: `${w * cols * scale}px ${h * SHEET_ROWS * scale}px`,
        imageRendering: "pixelated",
      }}
    />
  );
}

export function CharacterPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const characters = executiveCharacters.filter((c) => c.spriteSheet);

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
        {characters.map((character) => {
          const selected = character.id === selectedId;
          return (
            <button
              key={character.id}
              type="button"
              onClick={() => onSelect(character.id)}
              aria-pressed={selected}
              title={character.name}
              className="flex w-[92px] flex-col items-center gap-1.5 rounded-md border px-2 pb-2 pt-2.5 transition-colors"
              style={{
                background: selected ? "rgba(201, 168, 76, 0.08)" : "transparent",
                borderColor: selected ? character.themeColor : "rgba(201, 168, 76, 0.2)",
                borderWidth: selected ? 2 : 1,
                boxShadow: selected ? `0 0 0 1px ${character.themeColor}55` : "none",
              }}
            >
              <SpriteThumb
                spriteSheet={character.spriteSheet as string}
                frameMapKind={character.frameMapKind}
              />
              <span
                className="text-center text-[10px] leading-tight"
                style={{
                  color: selected ? character.themeColor : "#c9a84c",
                  fontFamily: "Georgia, 'Times New Roman', serif",
                }}
              >
                {character.name}
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
 * executive's avatar + name as a chip, and opens the full CharacterPicker in a
 * dropdown popover. Designed to sit inline on one horizontal line beside the
 * office-data metrics.
 */
export function CharacterChip({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const character =
    executiveCharacters.find((c) => c.id === selectedId && c.spriteSheet) ??
    executiveCharacters.find((c) => c.spriteSheet);
  if (!character) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Current character: ${character.name}. Change character.`}
        className="flex items-center gap-2 rounded-xl border px-2.5 py-1.5 transition-colors"
        style={{
          background: "rgba(10, 8, 6, 0.7)",
          borderColor: open ? character.themeColor : "rgba(201, 168, 76, 0.35)",
        }}
      >
        <span className="grid h-6 w-6 place-items-center overflow-hidden rounded-md" style={{ background: "#0a0806" }}>
          <SpriteThumb
            spriteSheet={character.spriteSheet as string}
            frameMapKind={character.frameMapKind}
            scale={0.85}
          />
        </span>
        <span className="flex flex-col items-start leading-tight">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-muted">Character</span>
          <span className="text-sm font-semibold text-fg-primary">{character.name}</span>
        </span>
        <span aria-hidden className="ml-0.5 text-[10px] text-fg-muted transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }}>
          ▾
        </span>
      </button>
      {open ? (
        <>
          {/* Click-away backdrop */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-max max-w-[320px]">
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
