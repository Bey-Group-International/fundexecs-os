"use client";

// Compact numeric pager. Presentational — the parent owns the page state and
// re-runs the explorer. Windows the page buttons around the current page so the
// control stays small even with many pages.
export function Pagination({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
}) {
  if (pageCount <= 1) return null;

  const window = 1; // pages shown on each side of the current one
  const nums: number[] = [];
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || (p >= page - window && p <= page + window)) nums.push(p);
  }

  const items: (number | "gap")[] = [];
  let prev = 0;
  for (const n of nums) {
    if (n - prev > 1) items.push("gap");
    items.push(n);
    prev = n;
  }

  const base =
    "min-w-8 rounded-md border px-2 py-1 font-mono text-xs transition disabled:opacity-40";

  return (
    <nav className="mt-6 flex items-center justify-center gap-1.5" aria-label="Pagination">
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className={`${base} border-line text-fg-muted hover:border-gold-500/40 hover:text-fg-secondary`}
        aria-label="Previous page"
      >
        ←
      </button>
      {items.map((it, i) =>
        it === "gap" ? (
          <span key={`gap-${i}`} className="px-1 text-fg-muted">
            …
          </span>
        ) : (
          <button
            key={it}
            type="button"
            onClick={() => onPage(it)}
            aria-current={it === page ? "page" : undefined}
            className={`${base} ${
              it === page
                ? "border-gold-500/60 bg-gold-500/15 text-gold-300"
                : "border-line text-fg-muted hover:border-gold-500/40 hover:text-fg-secondary"
            }`}
          >
            {it}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page >= pageCount}
        className={`${base} border-line text-fg-muted hover:border-gold-500/40 hover:text-fg-secondary`}
        aria-label="Next page"
      >
        →
      </button>
    </nav>
  );
}
