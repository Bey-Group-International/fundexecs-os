"use client";

import { useEffect, useMemo, useRef } from "react";
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

  return (
    <div className="h-[calc(100dvh-8rem)] min-h-[420px] w-full overflow-hidden bg-[#070c16]">
      <iframe
        ref={ref}
        src="/office/map.html"
        title="FundExecs OS — Virtual Office"
        className="h-full w-full border-0"
      />
    </div>
  );
}
