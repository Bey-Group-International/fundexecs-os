"use client";

import { useCallback, useEffect, useState } from "react";
import { executiveCharacters } from "@/components/characters/characterConfig";

export const CHARACTER_STORAGE_KEY = "fx-office-character";
const DEFAULT_CHARACTER_ID = "earnest-fundmaker";

/** Frame dimensions per sprite-sheet layout (row 0 frame 0 = idle facing down). */
const FRAME_SIZE: Record<"earnest" | "executive", { w: number; h: number }> = {
  earnest: { w: 32, h: 32 },
  executive: { w: 16, h: 32 },
};

/** Sheets are 4 frames wide × 5 rows tall. */
const SHEET_COLS = 4;
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
}: {
  spriteSheet: string;
  frameMapKind: "earnest" | "executive";
}) {
  const { w, h } = FRAME_SIZE[frameMapKind];
  const scale = 2;
  return (
    <div
      aria-hidden
      style={{
        width: w * scale,
        height: h * scale,
        backgroundImage: `url(${spriteSheet})`,
        backgroundPosition: "0 0",
        backgroundRepeat: "no-repeat",
        backgroundSize: `${w * SHEET_COLS * scale}px ${h * SHEET_ROWS * scale}px`,
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
