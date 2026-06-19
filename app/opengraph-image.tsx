import { ImageResponse } from "next/og";
import { BRAND, SITE_NAME, SITE_TAGLINE, SITE_DESCRIPTION } from "@/lib/site";

// Runtime-rendered social card. Next uses this single file for both the
// OpenGraph and Twitter `summary_large_image` previews, so link unfurls on
// X / LinkedIn / Slack / iMessage are never blank. Replace with a static
// app/opengraph-image.png to override with provided artwork.
export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BRAND.background,
          padding: 80,
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 26,
            letterSpacing: 6,
            textTransform: "uppercase",
            color: BRAND.gold,
          }}
        >
          {SITE_NAME}
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 76,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -2,
              color: BRAND.fg,
            }}
          >
            Agents that own the work.
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 30,
              lineHeight: 1.35,
              maxWidth: 900,
              color: BRAND.fgMuted,
            }}
          >
            {SITE_DESCRIPTION}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 22,
            color: BRAND.fgMuted,
          }}
        >
          Data model first. Agents second. Capital third.
        </div>
      </div>
    ),
    { ...size },
  );
}
