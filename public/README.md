# Static assets (`/public`)

Files here are served from the site root (e.g. `public/logo.svg` → `/logo.svg`).

## Brand / logo

The wordmark is centralized in [`components/Logo.tsx`](../components/Logo.tsx).
To use a logo image instead of the text wordmark:

1. Drop the file here, e.g. `public/logo.svg` (preferred) or `public/logo.png`
   (use a transparent background; min 512×512 for raster).
2. In `components/Logo.tsx`, render it with `next/image` instead of the text.

## Icons & social card (handled in `app/`, not here)

These are generated as Next.js file conventions — override by adding a static
file with the same name:

| Purpose            | Current source            | Static override            |
| ------------------ | ------------------------- | -------------------------- |
| Favicon            | `app/icon.svg`            | `app/favicon.ico`          |
| Apple touch icon   | `app/apple-icon.tsx`      | `app/apple-icon.png` (180²)|
| OG / Twitter card  | `app/opengraph-image.tsx` | `app/opengraph-image.png` (1200×630) |

The runtime-rendered versions use the brand palette from `lib/site.ts`, so
social previews and icons work today even before final artwork is dropped in.
