import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/site";

// Apple touch icon, rendered at runtime so it stays in sync with the brand
// palette. Replace with a provided PNG at app/apple-icon.png to override.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND.background,
          color: BRAND.gold,
          fontSize: 120,
          fontWeight: 700,
          letterSpacing: -4,
        }}
      >
        F
      </div>
    ),
    { ...size },
  );
}
