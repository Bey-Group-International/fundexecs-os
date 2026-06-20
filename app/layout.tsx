import type { Metadata } from "next";
import Script from "next/script";
import { Space_Grotesk, DM_Sans, JetBrains_Mono } from "next/font/google";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site";
import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});
const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "private capital",
    "private markets",
    "AI agents",
    "deal sourcing",
    "underwriting",
    "LP relations",
    "fund operations",
    "venture capital",
    "private equity",
    "family office",
  ],
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "business",
  alternates: {
    canonical: "/",
  },
  // Icons are driven by the app/ file conventions (favicon.ico, icon.png,
  // apple-icon.png) — all rendered from the Earn coin brand mark.
  manifest: "/manifest.webmanifest",
  // app/opengraph-image.png feeds both OG and Twitter cards automatically.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EEF4FC" },
    { media: "(prefers-color-scheme: dark)", color: "#050912" },
  ],
  colorScheme: "dark light" as const,
};

const themeBootstrap = `
try {
  var stored = window.localStorage.getItem("fx-theme");
  var prefersDay = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  var mode = stored === "day" || stored === "night" ? stored : (prefersDay ? "day" : "night");
  var root = document.documentElement;
  root.classList.remove("theme-day", "theme-night");
  root.classList.add(mode === "day" ? "theme-day" : "theme-night");
  root.dataset.theme = mode;
  root.style.colorScheme = mode === "day" ? "light" : "dark";
} catch (_) {}
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen antialiased">
        <Script id="fx-theme-bootstrap" strategy="beforeInteractive">
          {themeBootstrap}
        </Script>
        {children}
      </body>
    </html>
  );
}
