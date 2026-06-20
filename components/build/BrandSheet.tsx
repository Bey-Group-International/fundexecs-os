import { PrintButton } from "./PrintButton";

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

function safeHex(value: string | null | undefined): string | null {
  return value && HEX_RE.test(value) ? value : null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold-500 print:text-neutral-600">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Swatch({ hex, label }: { hex: string; label?: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className="h-12 w-12 rounded-lg border border-line print:border-neutral-300"
        style={{ backgroundColor: hex }}
      />
      <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted print:text-neutral-500">
        {hex}
      </span>
      {label ? (
        <span className="font-mono text-[8px] uppercase tracking-wider text-gold-500 print:text-neutral-600">
          {label}
        </span>
      ) : null}
    </div>
  );
}

type BrandSheetProps = {
  firmName: string;
  logoUrl: string | null;
  tagline: string | null;
  brandColor: string | null;
  brandVoice: string | null;
  brandPalette: string[];
};

// A clean, print-ready one-page brand sheet: logo, tagline, primary color,
// full palette with hex labels, and brand voice. Mirrors the one-pager's
// print styling so it exports as a tidy light-theme tear sheet.
export function BrandSheet({
  firmName,
  logoUrl,
  tagline,
  brandColor,
  brandVoice,
  brandPalette,
}: BrandSheetProps) {
  const accent = safeHex(brandColor);
  const palette = brandPalette.filter((c) => HEX_RE.test(c));
  const initial = (firmName || "F").charAt(0).toUpperCase();

  return (
    <div className="mt-10">
      {/* Toolbar — hidden in print */}
      <div className="mb-5 flex items-center justify-between gap-4 print:hidden">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-fg-primary">
            Brand Sheet
          </h2>
          <p className="mt-0.5 text-sm text-fg-secondary">
            A one-page brand reference you can export and share.
          </p>
        </div>
        <PrintButton />
      </div>

      {/* The sheet */}
      <article className="mx-auto max-w-2xl rounded-2xl border border-line bg-surface-1 p-8 print:max-w-none print:rounded-none print:border-0 print:bg-white print:p-0 print:text-black">
        <header
          className="flex items-start gap-4 border-b pb-5"
          style={{ borderColor: accent ? `${accent}55` : undefined }}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-contain" />
          ) : (
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg font-display text-xl font-semibold text-surface-0"
              style={{ backgroundColor: accent ?? "#D4AF6A" }}
            >
              {initial}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-fg-primary print:text-black">
              {firmName || "Your Firm"}
            </h1>
            {tagline ? (
              <p className="mt-0.5 text-sm text-fg-secondary print:text-neutral-700">{tagline}</p>
            ) : null}
          </div>
        </header>

        <Section title="Primary Color">
          {accent ? (
            <div className="flex items-center gap-3">
              <span
                className="h-12 w-12 rounded-lg border border-line print:border-neutral-300"
                style={{ backgroundColor: accent }}
              />
              <span className="font-mono text-sm uppercase tracking-wider text-fg-primary print:text-black">
                {accent}
              </span>
            </div>
          ) : (
            <p className="text-sm text-fg-muted print:text-neutral-500">No primary color set.</p>
          )}
        </Section>

        <Section title="Palette">
          {palette.length ? (
            <div className="flex flex-wrap gap-4">
              {palette.map((c) => (
                <Swatch key={c} hex={c} label={accent && c.toLowerCase() === accent.toLowerCase() ? "primary" : undefined} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-fg-muted print:text-neutral-500">No palette captured yet.</p>
          )}
        </Section>

        <Section title="Brand Voice">
          {brandVoice ? (
            <p className="text-sm text-fg-secondary print:text-neutral-700">{brandVoice}</p>
          ) : (
            <p className="text-sm text-fg-muted print:text-neutral-500">No brand voice selected.</p>
          )}
        </Section>

        <footer className="mt-6 border-t border-line pt-3 print:border-neutral-300">
          <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted print:text-neutral-400">
            {firmName || ""} · Brand reference
          </p>
        </footer>
      </article>
    </div>
  );
}
