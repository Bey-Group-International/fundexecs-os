"use client";

import { useEffect, useState } from "react";
import type { AlertEvent } from "@/lib/alert-rules";

interface AlertEventWithRule extends AlertEvent {
  rule_name?: string;
}

interface Props {
  orgId: string;
}

async function fetchUnacknowledgedAlerts(
  orgId: string,
): Promise<AlertEventWithRule[]> {
  const res = await fetch(`/api/alerts?orgId=${encodeURIComponent(orgId)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    console.error("SmartAlertBanner: failed to fetch alerts", res.status);
    return [];
  }
  return res.json() as Promise<AlertEventWithRule[]>;
}

async function acknowledgeAlert(id: string): Promise<void> {
  const res = await fetch(`/api/alerts/${encodeURIComponent(id)}/acknowledge`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`acknowledge failed: ${res.status}`);
  }
}

function severityFromPayload(payload?: Record<string, unknown>): "active" | "escalated" {
  if (payload && payload["escalated"] === true) return "escalated";
  return "active";
}

function AlertBanner({
  alert,
  onDismiss,
}: {
  alert: AlertEventWithRule;
  onDismiss: (id: string) => void;
}) {
  const severity = severityFromPayload(alert.payload);
  const isEscalated = severity === "escalated";

  const barColor = isEscalated
    ? "bg-status-warning"
    : "bg-status-danger";

  const wrapperBg = isEscalated
    ? "bg-status-warning/10 border-status-warning"
    : "bg-status-danger/10 border-status-danger";

  const entityLabel = [alert.entity_type, alert.entity_id]
    .filter(Boolean)
    .join(" · ");

  function handleDismiss() {
    // Optimistic: remove immediately
    onDismiss(alert.id);
    // Fire-and-forget in background
    acknowledgeAlert(alert.id).catch((err) => {
      console.error("SmartAlertBanner: acknowledge error", err);
    });
  }

  function handleInvestigate() {
    console.log("Investigate alert:", alert);
  }

  return (
    <div
      className={`flex items-stretch rounded-md border ${wrapperBg} overflow-hidden`}
      role="alert"
    >
      {/* Left colored bar */}
      <div className={`w-1 shrink-0 ${barColor}`} aria-hidden="true" />

      {/* Content */}
      <div className="flex flex-1 items-center gap-3 px-3 py-2">
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-medium text-fg-primary truncate">
            {alert.rule_name ?? "Alert"}
          </span>
          {entityLabel && (
            <span className="text-xs text-fg-secondary truncate">
              {entityLabel}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleInvestigate}
            className="text-xs font-medium text-fg-secondary hover:text-fg-primary transition-colors px-2 py-1 rounded hover:bg-surface-overlay"
          >
            Investigate
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-xs font-medium text-fg-primary bg-surface-overlay hover:bg-surface-elevated border border-border-default transition-colors px-2 py-1 rounded"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

export function SmartAlertBanner({ orgId }: Props) {
  const [alerts, setAlerts] = useState<AlertEventWithRule[]>([]);

  useEffect(() => {
    fetchUnacknowledgedAlerts(orgId).then(setAlerts).catch((err) => {
      console.error("SmartAlertBanner: mount fetch error", err);
    });
  }, [orgId]);

  if (alerts.length === 0) return null;

  function handleDismiss(id: string) {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="flex flex-col gap-2 w-full" aria-label="Alert banners">
      {alerts.map((alert) => (
        <AlertBanner key={alert.id} alert={alert} onDismiss={handleDismiss} />
      ))}
    </div>
  );
}
