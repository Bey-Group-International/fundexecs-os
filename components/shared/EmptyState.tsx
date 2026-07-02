"use client";

import { useRouter } from "next/navigation";

interface EmptyStateProps {
  title: string;
  description: string;
  primaryAction?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  copilotPrompt?: string;
  icon?: React.ReactNode;
}

export function EmptyState({
  title,
  description,
  primaryAction,
  copilotPrompt,
  icon,
}: EmptyStateProps) {
  const router = useRouter();

  function handleCopilotPrompt() {
    if (!copilotPrompt) return;
    // Fire the earn:open-with-context event that EarnCopilotDock listens to.
    window.dispatchEvent(
      new CustomEvent("earn:open-with-context", {
        detail: { prompt: copilotPrompt },
      }),
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-5 rounded-2xl border border-dashed border-line py-16 px-8 text-center animate-fade-up">
      {icon ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-surface-1 text-fg-muted">
          {icon}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-fg-primary">{title}</p>
        <p className="max-w-xs text-sm text-fg-muted">{description}</p>
      </div>

      <div className="flex items-center gap-2">
        {primaryAction ? (
          <button
            type="button"
            onClick={() => {
              if (primaryAction.onClick) {
                primaryAction.onClick();
              } else if (primaryAction.href) {
                router.push(primaryAction.href);
              }
            }}
            className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-gold-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
          >
            {primaryAction.label}
          </button>
        ) : null}

        {copilotPrompt ? (
          <button
            type="button"
            onClick={handleCopilotPrompt}
            className="rounded-lg border border-line px-4 py-2 text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
          >
            Ask Earn
          </button>
        ) : null}
      </div>
    </div>
  );
}
