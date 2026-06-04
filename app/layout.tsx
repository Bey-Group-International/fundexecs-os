import './globals.css';
import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';

const title = 'FundExecs OS — AI-native private-market command center';
const description =
  'FundExecs OS turns any fund into an execution machine — streamlining workflows, accelerating decisions, and leveling up operators so emerging managers can scale like top-tier institutions.';

export const metadata: Metadata = {
  metadataBase: new URL('https://fundexecs.com'),
  title: {
    default: title,
    template: '%s · FundExecs OS'
  },
  description,
  applicationName: 'FundExecs OS',
  openGraph: {
    title,
    description,
    type: 'website',
    siteName: 'FundExecs OS'
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description
  },
  robots: {
    index: true,
    follow: true
  }
};

export const viewport: Viewport = {
  themeColor: '#070b14'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
