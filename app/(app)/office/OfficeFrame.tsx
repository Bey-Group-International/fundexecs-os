"use client";

import { useEffect, useMemo, useRef } from "react";
import type React from "react";
import { avatarAtlasDataURL } from "@/lib/office/avatarSprite";
import { getCharacterPreset } from "@/lib/office/characterPresets";
import type { AvatarConfig } from "@/lib/office/avatarConfig";

export interface YouAvatar {
  config: AvatarConfig;
  name: string;
  status: string;
}

// Client wrapper around the office iframe. It generates the member's saved
// character into a 16-bit sprite ATLAS (PNG data URL, via the shared generator)
// in the browser and hands it into the self-contained map via postMessage —
// which renders it exactly like the AI-staff sprites. Delivery is race-proof two
// ways: we reply to the map's `fx-office-ready` handshake, and we also (re)post
// on iframe load and whenever the avatar changes.
export function OfficeFrame({ you }: { you: YouAvatar | null }) {
  const ref = useRef<HTMLIFrameElement>(null);

  // Two atlas sources feed the same office renderer:
  //  • a chosen ready-made preset → its pre-rendered walk.png URL (crisp, so we
  //    ask the map to render it smoothly), or
  //  • a custom character → the procedural atlas rasterized in-browser (low-res
  //    pixel art, rendered pixelated).
  const payload = useMemo(() => {
    if (!you) return null;
    const presetAtlas = getCharacterPreset(you.config.preset)?.atlas;
    if (presetAtlas) {
      return { type: "fx-you" as const, atlas: presetAtlas, smooth: true, name: you.name, status: you.status };
    }
    const atlas = avatarAtlasDataURL(you.config);
    if (!atlas) return null;
    return { type: "fx-you" as const, atlas, smooth: false, name: you.name, status: you.status };
  }, [you]);

  useEffect(() => {
    if (!payload) return;
    const iframe = ref.current;
    if (!iframe) return;
    const origin = window.location.origin;
    const post = () => iframe.contentWindow?.postMessage(payload, origin);

    const onReady = (e: MessageEvent) => {
      if (e.origin === origin && e.data?.type === "fx-office-ready") post();
    };
    window.addEventListener("message", onReady);
    iframe.addEventListener("load", post);
    post(); // in case the map is already up

    return () => {
      window.removeEventListener("message", onReady);
      iframe.removeEventListener("load", post);
    };
  }, [payload]);

  useMovementKeyBridge(ref);

  return (
    <div
      className="h-[calc(100dvh-8rem)] min-h-[420px] w-full overflow-hidden bg-surface-3"
      // Hovering the office hands it the keyboard, so WASD walks straight away
      // instead of only after the member has clicked inside the iframe.
      onPointerEnter={() => ref.current?.contentWindow?.focus()}
    >
      <iframe
        ref={ref}
        src="/office/map.html"
        title="FundExecs OS — Virtual Office"
        className="h-full w-full border-0"
      />
    </div>
  );
}

const MOVE_KEYS = new Set([
  "w", "a", "s", "d",
  "arrowup", "arrowdown", "arrowleft", "arrowright",
  "shift",
]);

// Walking the office is keyboard-driven, but the map is an iframe: while focus sits
// anywhere on the host page (the sidebar, a link the member tabbed to, the document
// itself right after navigation) its own key listeners never fire and the avatar
// simply doesn't move. Forward the movement keys we receive instead — when the
// iframe does hold focus the host never sees them, so this can't double-fire.
function useMovementKeyBridge(ref: React.RefObject<HTMLIFrameElement | null>) {
  useEffect(() => {
    const origin = window.location.origin;
    const send = (down: boolean) => (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!MOVE_KEYS.has(k) || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (k.startsWith("arrow")) e.preventDefault(); // arrows would otherwise scroll the page
      ref.current?.contentWindow?.postMessage({ type: "fx-key", down, key: k }, origin);
    };
    const onDown = send(true), onUp = send(false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [ref]);
}
