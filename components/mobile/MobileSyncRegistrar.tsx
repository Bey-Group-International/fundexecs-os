"use client";

import { useEffect } from "react";
import { registerExecutor } from "./offlineQueue";
import { decideApprovalAction } from "@/app/(app)/approvals/actions";

// The type key + payload shape for a queued approval decision. Shared between
// the approvals flow (which enqueues) and this registrar (which executes), so
// the two never drift.
export const APPROVAL_DECISION_TYPE = "approval-decision";

export interface ApprovalDecisionPayload {
  approvalId: string;
  decision: "approved" | "rejected" | "regenerate";
  note?: string;
  title: string;
}

// Registers the mobile offline queue's executors app-wide, so a decision made
// on one screen still flushes on reconnect even after the operator navigates
// away. Mounted once in the app shell; renders nothing. Registering also drains
// anything left in the queue from a previous (offline) session.
export function MobileSyncRegistrar() {
  useEffect(() => {
    registerExecutor(APPROVAL_DECISION_TYPE, async (payload) => {
      const p = payload as ApprovalDecisionPayload;
      const res = await decideApprovalAction(p.approvalId, p.decision, p.note);
      return Boolean(res?.ok);
    });
  }, []);

  return null;
}
