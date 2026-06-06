import './globals.css';
import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Analytics } from '@vercel/analytics/next';

const title = 'FundExecs OS — AI-native private-market command center';
const description =
  'FundExecs OS turns any fund into an execution machine — streamlining workflows, accelerating decisions, and leveling up operators so emerging managers can scale like top-tier institutions.';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.fundexecs.com'),
  title: {
    default: title,
    template: '%s · FundExecs OS'
  },
  description,
  applicationName: 'FundExecs OS',
  icons: {
    icon: '/earn-coin.png',
    shortcut: '/earn-coin.png',
    apple: '/earn-coin.png'
  },
  openGraph: {
    title,
    description,
    type: 'website',
    siteName: 'FundExecs OS',
    images: [{ url: '/earn-coin.png', width: 1024, height: 1024, alt: 'FundExecs OS' }]
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/earn-coin.png']
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
  // Set the persisted theme before paint to avoid a flash. Dark is default.
  const themeBootstrap = `(function(){try{var t=localStorage.getItem('fx-theme');if(t==='light'){document.documentElement.setAttribute('data-theme','light');}}catch(e){}})();`;
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
