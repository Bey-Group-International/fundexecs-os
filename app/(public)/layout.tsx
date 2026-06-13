import type { Metadata } from 'next';
import { EarnCoin } from '@/components/ui/EarnCoin';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.fundexecs.com')
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#070b14] text-[#cbd5e1]">
      <header className="border-b border-white/[0.06] px-6 py-4">
        <a href="/" className="flex items-center gap-2 w-fit">
          <EarnCoin size={28} />
          <span className="text-sm font-semibold text-white tracking-tight">FundExecs OS</span>
        </a>
      </header>
      {children}
      <footer className="border-t border-white/[0.06] px-6 py-8 mt-16 text-center text-xs text-[#7a899e]">
        © {new Date().getFullYear()} FundExecs OS · Private-market command center
      </footer>
    </div>
  );
}
