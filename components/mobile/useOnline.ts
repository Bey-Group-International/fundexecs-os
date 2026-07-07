"use client";

import { useEffect, useState } from "react";

// Tracks the browser's connectivity for the mobile app. On-the-go users move
// through dead zones constantly, so screens and actions can consult this to
// block or defer network work and tell the user why. SSR-safe (assumes online
// until the client confirms).
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return online;
}
