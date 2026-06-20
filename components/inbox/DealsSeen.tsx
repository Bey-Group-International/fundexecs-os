"use client";

// components/inbox/DealsSeen.tsx
// Marks shared-deal alerts read when the "deals that fit you" feed is opened,
// clearing the lightbulb badge. Runs the mutation in an effect (not during
// render) and fires once per mount.
import { useEffect, useRef } from "react";
import { markDealAlertsRead } from "@/app/(app)/nav-actions";

export function DealsSeen() {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void markDealAlertsRead();
  }, []);
  return null;
}
