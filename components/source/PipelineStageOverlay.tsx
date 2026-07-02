"use client";

import { PipelineStage } from "@/lib/pipeline-stages";

interface PipelineStageOverlayProps {
  stage: PipelineStage;
  onConfirm: () => void;
  onCancel: () => void;
  open: boolean;
}

const ACTION_TYPE_COLORS: Record<string, string> = {
  email: "bg-blue-100 text-blue-800 border-blue-200",
  task: "bg-amber-100 text-amber-800 border-amber-200",
  webhook: "bg-purple-100 text-purple-800 border-purple-200",
  notification: "bg-green-100 text-green-800 border-green-200",
  slack: "bg-pink-100 text-pink-800 border-pink-200",
  default: "bg-gray-100 text-gray-700 border-gray-200",
};

function actionChipColor(actionType: string): string {
  return ACTION_TYPE_COLORS[actionType] ?? ACTION_TYPE_COLORS.default;
}

export default function PipelineStageOverlay({
  stage,
  onConfirm,
  onCancel,
  open,
}: PipelineStageOverlayProps) {
  const entryConditionKeys = Object.keys(stage.entry_conditions);
  const hasRequiredArtifacts = stage.required_artifacts.length > 0;
  const hasAutoActions = stage.auto_actions.length > 0;

  return (
    <div
      aria-modal="true"
      aria-labelledby="overlay-stage-heading"
      role="dialog"
      className={[
        "fixed inset-0 z-50 flex items-center justify-center p-4",
        "bg-black/50 backdrop-blur-sm",
        "transition-opacity duration-200",
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
      ].join(" ")}
    >
      <div
        className={[
          "w-full max-w-md rounded-xl border border-line bg-surface-0 shadow-xl",
          "transition-transform duration-200",
          open ? "scale-100" : "scale-95",
        ].join(" ")}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-line">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-muted mb-1">
            Moving deal to
          </p>
          <h2
            id="overlay-stage-heading"
            className="text-lg font-semibold text-fg-primary"
          >
            {stage.name}
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-5">
          {/* Required artifacts */}
          {hasRequiredArtifacts && (
            <section>
              <h3 className="text-sm font-medium text-fg-primary mb-2">
                Required artifacts
              </h3>
              <ul className="space-y-1.5">
                {stage.required_artifacts.map((artifact) => (
                  <li key={artifact} className="flex items-center gap-2 text-sm text-fg-muted">
                    <svg
                      className="w-4 h-4 shrink-0 text-fg-muted"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      aria-hidden="true"
                    >
                      <rect x="3" y="3" width="14" height="14" rx="3" />
                    </svg>
                    <span>{artifact}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Auto-actions */}
          {hasAutoActions && (
            <section>
              <h3 className="text-sm font-medium text-fg-primary mb-2">
                Automations that will fire
              </h3>
              <div className="flex flex-wrap gap-2">
                {stage.auto_actions.map((action, index) => (
                  <span
                    key={index}
                    className={[
                      "inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-medium",
                      actionChipColor(action.action_type),
                    ].join(" ")}
                  >
                    {action.action_type}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Entry conditions */}
          <section>
            <h3 className="text-sm font-medium text-fg-primary mb-2">
              Entry requirements
            </h3>
            {entryConditionKeys.length === 0 ? (
              <p className="text-sm text-fg-muted">No entry requirements</p>
            ) : (
              <ul className="space-y-1 list-disc list-inside">
                {entryConditionKeys.map((key) => (
                  <li key={key} className="text-sm text-fg-muted">
                    <span className="font-medium text-fg-primary">{key}</span>
                    {": "}
                    {String(stage.entry_conditions[key])}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 pt-2 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-line bg-surface-0 text-sm font-medium text-fg-primary hover:bg-surface-1 transition-colors duration-150"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-fg-primary text-surface-0 text-sm font-medium hover:opacity-90 transition-opacity duration-150"
          >
            Confirm move
          </button>
        </div>
      </div>
    </div>
  );
}
