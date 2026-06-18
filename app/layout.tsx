import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FundExecs OS",
  description:
    "An AI-native operating system for private-market participants — unifying relationships, deals, and capital into a single intelligence layer.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
