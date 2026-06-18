import type { Metadata } from "next";
import { Space_Grotesk, DM_Sans, JetBrains_Mono } from "next/font/google";
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

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://fundexecs.os";
const DESCRIPTION =
  "The AI-native operating system for private capital. Six agents source deals, underwrite, manage LPs, and own the work — on a schedule, approval-gated by default.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "FundExecs OS — Agents that own the work",
    template: "%s · FundExecs OS",
  },
  description: DESCRIPTION,
  applicationName: "FundExecs OS",
  openGraph: {
    type: "website",
    siteName: "FundExecs OS",
    title: "FundExecs OS — Agents that own the work",
    description: DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "FundExecs OS — Agents that own the work",
    description: DESCRIPTION,
  },
};

export const viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
    >
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
