"use client";

import React, { useRef, useState, useTransition, type ReactNode, type MutableRefObject } from "react";
import { useRouter } from "next/navigation";

type SaveStatus = "idle" | "saving" | "saved" | "error";

// Wraps a set of form fields and autosaves them via a server action. On any
// input/change, it debounces (~800ms) and then submits the form, showing a
// subtle status indicator in the corner.
export function AutosaveForm({
  action,
  children,
  className,
  formRef: externalRef,
}: {
  action: (formData: FormData) => Promise<void>;
  children: ReactNode;
  className?: string;
  formRef?: MutableRefObject<HTMLFormElement | null>;
}) {
  const internalRef = useRef<HTMLFormElement>(null);
  const formRef = externalRef ?? internalRef;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [, startTransition] = useTransition();
  const router = useRouter();

  function scheduleSave() {
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      formRef.current?.requestSubmit();
    }, 800);
  }

  async function handleSubmit(formData: FormData) {
    setStatus("saving");
    startTransition(async () => {
      try {
        await action(formData);
        setStatus("saved");
        router.refresh();
      } catch {
        setStatus("error");
      }
    });
  }

  return (
    <form
      ref={formRef as React.RefObject<HTMLFormElement>}
      action={handleSubmit}
      onInput={scheduleSave}
      onChange={scheduleSave}
      className={`relative ${className ?? ""}`}
    >
      <div
        aria-live="polite"
        className="pointer-events-none absolute right-0 top-0 font-mono text-[10px] uppercase tracking-wider"
      >
        {status === "saving" ? (
          <span className="text-fg-muted">Saving…</span>
        ) : status === "saved" ? (
          <span className="text-status-success">Saved ✓</span>
        ) : status === "error" ? (
          <span className="text-status-danger">Save failed — retry</span>
        ) : (
          <span className="text-fg-muted">Saved</span>
        )}
      </div>
      {children}
    </form>
  );
}
