"use client";

// AuthHandoffNotice — shown when a browser-operator session is
// `paused_for_user_auth`. Earn cannot see or store the operator's password; the
// operator signs in directly in the secure window and then tells Earn to
// continue. This is the credential-safety boundary made visible.

type Props = {
  /** Which source the operator needs to sign into, for the copy. */
  sourceLabel?: string;
  pending?: boolean;
  onResume: () => void;
  onCancel: () => void;
};

export function AuthHandoffNotice({ sourceLabel, pending, onResume, onCancel }: Props) {
  return (
    <div className="rounded-2xl border border-gold-500/50 bg-surface-2 p-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">
        Action paused
      </p>
      <h3 className="mt-1 text-base font-semibold text-fg">
        Sign in directly in the secure window
      </h3>
      <p className="mt-2 text-sm text-fg-muted">
        {sourceLabel ? `${sourceLabel} needs you to authenticate. ` : ""}
        Earn cannot see or store your password. Complete the sign-in yourself in
        the browser window, then let Earn know it may continue.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onResume}
          disabled={pending}
          className="rounded-md border border-gold-500/60 bg-gold-500/10 px-3 py-2 text-sm font-medium text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
        >
          {pending ? "Resuming…" : "I'm signed in, Earn may continue"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border border-line px-3 py-2 text-sm text-fg-muted transition hover:text-fg disabled:opacity-50"
        >
          Stop the session
        </button>
      </div>
    </div>
  );
}
