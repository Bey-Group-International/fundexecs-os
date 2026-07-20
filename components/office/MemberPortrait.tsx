"use client";

// A member's premium AI portrait for roster and profile cards. Self-contained:
// renders the cached image when present, else a tasteful gradient-monogram
// fallback (the member's first initial on an accent gradient). Deliberately
// does NOT import the pixel/vector engine — it's a plain, cheap display card
// that works anywhere the portrait URL is known.

interface MemberPortraitProps {
  /** Public portrait URL, or null to show the monogram fallback. */
  url: string | null;
  /** Member display name — used for the alt text and the monogram initial. */
  name: string;
  /** Rendered square size in CSS pixels (default 64). */
  size?: number;
  /** Accent hex for the fallback gradient (default a neutral indigo). */
  accent?: string;
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "?";
}

export function MemberPortrait({
  url,
  name,
  size = 64,
  accent = "#4f46e5",
}: MemberPortraitProps) {
  const dimension = { width: size, height: size };

  if (url) {
    return (
      // Portrait URLs are dynamic Supabase Storage links, not build-time
      // assets, so next/image optimization doesn't apply here.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        loading="lazy"
        className="rounded-full object-cover ring-1 ring-[var(--line)]"
        style={dimension}
      />
    );
  }

  return (
    <div
      role="img"
      aria-label={name}
      className="flex items-center justify-center rounded-full font-semibold text-white ring-1 ring-[var(--line)]"
      style={{
        ...dimension,
        fontSize: Math.round(size * 0.42),
        background: `linear-gradient(135deg, ${accent} 0%, ${accent}99 55%, #0f172a 100%)`,
      }}
    >
      {initialOf(name)}
    </div>
  );
}

export default MemberPortrait;
