"use client";

import { useEffect, useRef } from "react";

export interface YouAvatar {
  svg: string;
  name: string;
  status: string;
}

// Client wrapper around the office iframe. Its only job beyond hosting the frame
// is to hand the member's saved character (pre-rendered app-side) into the
// self-contained map via postMessage. Delivery is race-proof two ways: we reply
// to the map's `fx-office-ready` handshake, and we also (re)post on iframe load
// and whenever the avatar prop changes.
export function OfficeFrame({ you }: { you: YouAvatar | null }) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!you) return;
    const iframe = ref.current;
    if (!iframe) return;
    const origin = window.location.origin;
    const post = () => iframe.contentWindow?.postMessage({ type: "fx-you", ...you }, origin);

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
  }, [you]);

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
