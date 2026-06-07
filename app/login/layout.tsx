import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in to FundExecs OS — your AI-native private-market command center.',
  openGraph: {
    title: 'Sign In · FundExecs OS',
    description: 'Sign in to FundExecs OS — your AI-native private-market command center.'
  },
  robots: { index: false, follow: false }
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
