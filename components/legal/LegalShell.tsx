import Link from 'next/link';
import { EarnCoin } from '@/components/screens/EarnCoin';

interface LegalShellProps {
  title: string;
  updated: string;
  children: React.ReactNode;
}

/** Minimal public chrome for legal pages — matches the landing/login surface. */
export function LegalShell({ title, updated, children }: LegalShellProps) {
  return (
    <main className="min-h-screen bg-bg-0 text-fg-1">
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-2.5">
            <EarnCoin size={26} />
            <span className="text-[14px] font-semibold tracking-tight">
              FundExecs <span className="text-fg-3">OS</span>
            </span>
          </Link>
          <Link href="/login" className="text-[12.5px] text-fg-4 transition hover:text-fg-2">
            Sign in
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">{title}</h1>
        <p className="mt-2 text-[12.5px] text-fg-4">Last updated {updated}</p>
        <div className="legal-body mt-8 space-y-6 text-[13.5px] leading-7 text-fg-3">
          {children}
        </div>
      </article>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-[12px] text-fg-5">
          <span>© {new Date().getFullYear()} FundExecs Technologies. All rights reserved.</span>
          <nav className="flex gap-4">
            <Link href="/privacy" className="transition hover:text-fg-3">
              Privacy
            </Link>
            <Link href="/terms" className="transition hover:text-fg-3">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}

/** Section heading used across legal pages. */
export function LegalHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[16px] font-semibold tracking-tight text-fg-1">{children}</h2>;
}
