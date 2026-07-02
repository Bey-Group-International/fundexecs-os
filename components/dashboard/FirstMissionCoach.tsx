"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useCoachingToast } from "@/components/shared/CoachingToast";

const SEEN_KEY = "fx-first-mission-seen";

interface FirstMissionCoachProps {
  /** Pass true when the org has no workflows yet (tasks.length === 0). */
  isFirstVisit: boolean;
}

export function FirstMissionCoach({ isFirstVisit }: FirstMissionCoachProps) {
  const { show } = useCoachingToast();
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (!isFirstVisit || fired.current) return;
    if (localStorage.getItem(SEEN_KEY)) return;

    fired.current = true;
    localStorage.setItem(SEEN_KEY, "1");

    show({
      title: "Start your first mission",
      body: "Open Earn Workspace to create a workflow — your AI agents will take it from there.",
      tone: "info",
      action: {
        label: "Open Workspace →",
        onClick: () => router.push("/workspace"),
      },
    });
  }, [isFirstVisit, show, router]);

  return null;
}
