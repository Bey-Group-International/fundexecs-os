/**
 * Deterministic team-avatar gradients.
 *
 * Every member of The Team gets a stable visual identity derived purely from
 * their `ai_brains.slug`. Server-safe: no `Math.random`, no `Date.now`, no
 * runtime state — identical input always produces identical output across SSR
 * and the client.
 *
 * Design rules (kept explicit so the lint of "gold = Earn only" is enforced
 * here):
 *   - Earn (the COO, slug `earnest-fundmaker`) is the ONLY member that renders
 *     in the gold palette (`--gold-1` → `--gold-2`). It uses a fixed gradient.
 *   - Every other specialist is placed deterministically within the
 *     institutional cool palette (azure → cool-violet → teal range). Hue,
 *     darker stop, and angle are all derived from a 32-bit FNV-1a hash of the
 *     slug.
 *   - No specialist may collide with the gold range (we clamp specialist hues
 *     well outside the warm band).
 */

export interface GradientStops {
  /** CSS color for the from-stop (lighter, top-left of the gradient). */
  from: string;
  /** CSS color for the to-stop (darker, bottom-right of the gradient). */
  to: string;
  /** Gradient angle in degrees (0 = horizontal-left, increases clockwise). */
  angle: number;
}

const COO_SLUG = 'earnest-fundmaker';

/**
 * Fast deterministic hash (FNV-1a, 32-bit). Pure: same input → same output.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime, kept inside JS' integer-safe range with `>>> 0`.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Map a byte (0–255) into an output range using a linear stretch.
 */
function byteToRange(byte: number, lo: number, hi: number): number {
  return lo + (byte / 255) * (hi - lo);
}

/**
 * Return the deterministic gradient for a given slug. The COO is a fixed gold
 * gradient; everyone else lands in the institutional cool palette.
 */
export function gradientForSlug(slug: string): GradientStops {
  if (slug === COO_SLUG) {
    // Earn — the ONLY gold avatar in The Team. References the design tokens so
    // theming flows through.
    return { from: 'var(--gold-1, #f7c948)', to: 'var(--gold-2, #d49b1e)', angle: 135 };
  }

  const h = fnv1a(slug);
  const byteA = h & 0xff;
  const byteB = (h >>> 8) & 0xff;
  const byteC = (h >>> 16) & 0xff;
  const byteD = (h >>> 24) & 0xff;

  // Hue is clamped to the institutional cool band, well clear of gold (~45°).
  // 200° = azure, 260° = cool indigo, 175° = teal accent.
  const hue = Math.round(byteToRange(byteA, 195, 255));
  // Second stop drifts ±18° from the primary hue so the gradient reads as a
  // single specialist's tone rather than a multi-color flag.
  const drift = Math.round(byteToRange(byteB, -18, 18));
  const hue2 = (((hue + drift) % 360) + 360) % 360;

  // Saturation and lightness held tight so every specialist reads at the same
  // institutional volume (no neon, no muddy washes).
  const sat = Math.round(byteToRange(byteC, 55, 72));
  const lFrom = Math.round(byteToRange(byteD, 60, 68));
  const lTo = Math.max(38, lFrom - 22);

  // Angle quantised to 15° steps so the design system feels intentional.
  const angle = Math.round(byteToRange((byteA + byteB) & 0xff, 90, 200) / 15) * 15;

  return {
    from: `hsl(${hue} ${sat}% ${lFrom}%)`,
    to: `hsl(${hue2} ${sat}% ${lTo}%)`,
    angle
  };
}

/**
 * Initials helper for the avatar — first letter of the first name + first
 * letter of the second word, capitalised. "Earnest Fundmaker" → "EF".
 */
export function initialsForName(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2);
  return words
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}

/**
 * Produce a self-contained inline SVG markup string for a specialist avatar.
 * Renders the deterministic gradient with the member's initials on top —
 * suitable for both server-side string embedding (e.g. a `dangerouslySetInnerHTML`
 * island, an email export, or an OG image) and as the body of a React node.
 *
 * `name` is only used for the initials and the `aria-label`; the gradient is
 * 100% driven by `slug` so the visual identity remains stable even if copy is
 * edited.
 */
export function avatarSvgForSlug(slug: string, name: string, size = 40): string {
  const { from, to, angle } = gradientForSlug(slug);
  const id = `tg-${fnv1a(slug).toString(16)}`;
  const initials = initialsForName(name);
  // Quantise rotate-from-angle to a unit vector for the linearGradient axis.
  const rad = (angle * Math.PI) / 180;
  const x1 = (0.5 - 0.5 * Math.cos(rad)).toFixed(3);
  const y1 = (0.5 - 0.5 * Math.sin(rad)).toFixed(3);
  const x2 = (0.5 + 0.5 * Math.cos(rad)).toFixed(3);
  const y2 = (0.5 + 0.5 * Math.sin(rad)).toFixed(3);
  const fontSize = Math.round(size * 0.4);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${name}"><defs><linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/></linearGradient></defs><rect width="${size}" height="${size}" rx="${Math.round(size * 0.32)}" fill="url(#${id})"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-family="ui-sans-serif,system-ui" font-weight="700" font-size="${fontSize}" fill="rgba(255,255,255,0.92)">${initials}</text></svg>`;
}
