// lib/richtext.ts
// A small, framework-agnostic "rich text" model + fluent builder, inspired by
// Kyori/PaperMC Adventure (https://github.com/PaperMC/adventure). Adventure models
// styled text as an immutable tree of Components — each node carries its own text,
// style (color, decorations), and interaction events (hover / click) and may hold
// styled children. This module reimplements that idea for the web: a plain data
// `TextComponent` tree that any renderer can walk (see components/RichText.tsx for a
// React one). It is deliberately dependency-free and contains NO React — the model
// and the renderer are cleanly separated exactly as Adventure separates its API from
// its platform-specific serializers.
//
// Differences from Adventure worth noting for anyone porting concepts across:
//   - Colors are plain "#rrggbb" hex strings rather than a NamedTextColor enum.
//   - Decorations (bold/italic/underlined/strikethrough) are optional booleans; an
//     absent flag means "not set" (we never emit an explicit `false`), mirroring
//     Adventure's TriState-ish "unset vs set" distinction in spirit.
//   - `gradient` is a convenience the vanilla API lacks: at build time it is expanded
//     into per-character child components (see applyGradient), the same trick the
//     MiniMessage `<gradient>` tag uses, so renderers never need gradient logic.

/**
 * A node in the rich-text tree. Analogous to Adventure's `Component`: it owns a run
 * of `text`, an optional style, optional interaction events, and optional styled
 * `children` that inherit nothing implicitly (each child is self-describing).
 */
export interface TextComponent {
  /** The literal text of this node (may be empty for a pure container). */
  text: string;
  /** Foreground color as a "#rrggbb" hex string. */
  color?: string;
  /** Bold decoration. Omitted when unset. */
  bold?: boolean;
  /** Italic decoration. Omitted when unset. */
  italic?: boolean;
  /** Underline decoration. Omitted when unset. */
  underlined?: boolean;
  /** Strikethrough decoration. Omitted when unset. */
  strikethrough?: boolean;
  /**
   * A gradient's color stops. Retained for provenance/serialization; the visible
   * gradient is expanded into per-character {@link children} at build time, so a
   * renderer can ignore this field and simply walk the children.
   */
  gradient?: string[];
  /** Hover tooltip text — Adventure's `HoverEvent.showText`, simplified to a string. */
  hover?: string;
  /** Click behaviour — Adventure's `ClickEvent`, narrowed to two web-safe actions. */
  click?: { action: "open_url" | "run"; value: string };
  /** Styled child nodes rendered after this node's own text. */
  children?: TextComponent[];
}

/** A hex stop parsed into its 0–255 RGB channels. */
interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse a "#rrggbb" (or "rrggbb") hex string into RGB channels. Falls back to black
 * for anything unparseable so gradient expansion never throws on bad input.
 */
function parseHex(hex: string): Rgb {
  const clean = hex.startsWith("#") ? hex.slice(1) : hex;
  if (clean.length !== 6) return { r: 0, g: 0, b: 0 };
  const n = Number.parseInt(clean, 16);
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** Format RGB channels back into a lowercase "#rrggbb" string. */
function toHex({ r, g, b }: Rgb): string {
  const h = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Linearly interpolate a color across an ordered list of stops at position `t`
 * (0..1). With N stops the range is split into N-1 equal segments and the channel
 * values are blended within the containing segment — the same linear RGB blend
 * Adventure/MiniMessage use for `<gradient>`.
 */
function interpolate(stops: Rgb[], t: number): Rgb {
  if (stops.length === 1) return stops[0];
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const scaled = clamped * (stops.length - 1);
  const i = Math.min(Math.floor(scaled), stops.length - 2);
  const local = scaled - i;
  const a = stops[i];
  const b = stops[i + 1];
  return {
    r: a.r + (b.r - a.r) * local,
    g: a.g + (b.g - a.g) * local,
    b: a.b + (b.b - a.b) * local,
  };
}

/**
 * Split `text` into one child {@link TextComponent} per character, each colored by
 * interpolating `stops` across the string (linear RGB). O(n) in the string length
 * and dependency-free. Used internally by {@link TextComponentBuilder.gradient} at
 * build time so renderers only ever walk children — they need no gradient logic.
 *
 * A single character (or a single stop) is colored with the first stop; an empty
 * string yields no children. Whitespace still produces a (colored) sub-component so
 * indices line up with the source text.
 */
export function applyGradient(text: string, stops: string[]): TextComponent[] {
  const chars = Array.from(text);
  if (chars.length === 0 || stops.length === 0) return [];
  const rgbStops = stops.map(parseHex);
  return chars.map((ch, i) => {
    const t = chars.length === 1 ? 0 : i / (chars.length - 1);
    return { text: ch, color: toHex(interpolate(rgbStops, t)) };
  });
}

/**
 * Fluent builder mirroring Adventure's `Component.text(...)` API. Every styling
 * method returns `this` for chaining; {@link build} produces the immutable
 * {@link TextComponent}. Prefer the {@link text} factory over constructing directly.
 */
export class TextComponentBuilder {
  private component: TextComponent;

  constructor(content: string) {
    this.component = { text: content };
  }

  /** Set the foreground color (a "#rrggbb" hex string). */
  color(hex: string): this {
    this.component.color = hex;
    return this;
  }

  /** Enable bold. */
  bold(): this {
    this.component.bold = true;
    return this;
  }

  /** Enable italic. */
  italic(): this {
    this.component.italic = true;
    return this;
  }

  /** Enable underline. */
  underlined(): this {
    this.component.underlined = true;
    return this;
  }

  /** Enable strikethrough. */
  strikethrough(): this {
    this.component.strikethrough = true;
    return this;
  }

  /**
   * Color this node's text as a gradient across `hexes`. The stops are recorded on
   * the component and, at {@link build} time, expanded into per-character children.
   */
  gradient(hexes: string[]): this {
    this.component.gradient = [...hexes];
    return this;
  }

  /** Attach a hover tooltip (Adventure's showText hover event). */
  hover(tooltip: string): this {
    this.component.hover = tooltip;
    return this;
  }

  /** Attach an open-url click event. */
  clickUrl(url: string): this {
    this.component.click = { action: "open_url", value: url };
    return this;
  }

  /** Attach a "run" click event carrying an opaque id/value for the host app. */
  clickRun(id: string): this {
    this.component.click = { action: "run", value: id };
    return this;
  }

  /** Append one or more children (builders are built in place). */
  append(...children: (TextComponentBuilder | TextComponent)[]): this {
    const built = children.map((c) => (c instanceof TextComponentBuilder ? c.build() : c));
    this.component.children = [...(this.component.children ?? []), ...built];
    return this;
  }

  /**
   * Materialize the immutable {@link TextComponent}. If a gradient was set, its
   * stops are expanded into per-character children here (prepended before any
   * explicitly appended children), so the model a renderer sees is fully resolved.
   */
  build(): TextComponent {
    const { gradient, text: content, children, ...rest } = this.component;
    if (gradient && gradient.length > 0 && content.length > 0) {
      const gradientChildren = applyGradient(content, gradient);
      return {
        ...rest,
        text: "",
        gradient,
        children: [...gradientChildren, ...(children ?? [])],
      };
    }
    return { ...rest, text: content, ...(children ? { children } : {}) };
  }
}

/**
 * Start a new component from a run of text — the web analogue of Adventure's
 * `Component.text("...")`. Chain styling methods, then call `.build()`.
 */
export function text(content: string): TextComponentBuilder {
  return new TextComponentBuilder(content);
}

/** An empty component — Adventure's `Component.empty()`. Useful as a container root. */
export function empty(): TextComponent {
  return { text: "" };
}

/**
 * Join `parts` with `sep` between each, returning a single container component whose
 * children are the parts interleaved with separators — the web analogue of
 * Adventure's `Component.join(...)`. `sep` may be a builder, a component, or a raw
 * string (wrapped as a plain text node).
 */
export function join(
  sep: TextComponentBuilder | TextComponent | string,
  ...parts: (TextComponentBuilder | TextComponent)[]
): TextComponent {
  const resolve = (v: TextComponentBuilder | TextComponent | string): TextComponent =>
    typeof v === "string" ? { text: v } : v instanceof TextComponentBuilder ? v.build() : v;
  const separator = resolve(sep);
  const children: TextComponent[] = [];
  parts.forEach((part, i) => {
    if (i > 0) children.push(separator);
    children.push(resolve(part));
  });
  return { text: "", children };
}

/**
 * Serialize a component tree to plain, unstyled text — this node's `text` followed
 * by each child's plain text, depth-first. Handy for aria-labels, logging, and
 * search indexing. The web analogue of Adventure's `PlainTextComponentSerializer`.
 */
export function toPlainText(c: TextComponent): string {
  const childText = (c.children ?? []).map(toPlainText).join("");
  return c.text + childText;
}
