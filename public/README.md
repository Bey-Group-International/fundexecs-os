# Static assets (`/public`)

Files here are served from the site root (e.g. `earn-coin.png` → `/earn-coin.png`).

## Brand / logo

The brand mark is the **Earn coin** (`public/earn-coin.png`, 1024×1024).

- In-app avatar: rendered via `next/image` (e.g. the landing hero orb in
  `app/page.tsx`); the text wordmark lives in `components/Logo.tsx`.
- PWA icons: `icon-192.png` / `icon-512.png` (coin on the brand background,
  maskable-safe) — referenced from `app/manifest.ts`.

All derived assets below are generated from `earn-coin.png`. To refresh them
after replacing the source, re-run the generation step in the PR that added
them (Pillow: circle-crop for icons, 1200×630 composite for the OG card).

## Icons & social card (Next.js `app/` file conventions)

These live in `app/` and are emitted automatically into `<head>`. Replace the
file to override:

|      Purpose      |          Source           |   Size   |
|-------------------|---------------------------|----------|
| Favicon           | `app/favicon.ico`         | 16/32/48 |
| Icon (modern)     | `app/icon.png`            | 48²      |
| Apple touch icon  | `app/apple-icon.png`      | 180²     |
| OG / Twitter card | `app/opengraph-image.png` | 1200×630 |

Keeping the favicon as a small `.ico`/`.png` (a few KB) rather than pointing at
the full 1024² `earn-coin.png` avoids shipping ~750 KB just to paint a tab icon.
