import { draftWithEarn } from "./actions";

// Opens an Earn session pre-prompted to draft this module's artifact.
export function DraftWithEarn({ module }: { module: string }) {
  return (
    <form action={draftWithEarn}>
      <input type="hidden" name="module" value={module} />
      <button type="submit" className="rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20">
        ✶ Draft with Earn
      </button>
    </form>
  );
}

// Section header with an optional Draft-with-Earn action on the right.
export function ModuleHeader({
  title,
  blurb,
  module,
}: {
  title: string;
  blurb: string;
  module?: string;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-tight text-fg-primary">{title}</h2>
        <p className="mt-0.5 text-sm text-fg-secondary">{blurb}</p>
      </div>
      {module ? <DraftWithEarn module={module} /> : null}
    </div>
  );
}

// Shared field styles.
export const inputClass =
  "rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none";
