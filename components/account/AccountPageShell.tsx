import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { EarnCoin } from '@/components/screens/EarnCoin';

interface AccountPageShellProps {
  /** Eyebrow label above the title (e.g. "Support"). */
  eyebrow?: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}

/**
 * Light public chrome for the account-menu satellite pages (Gift, Help,
 * What's new, Documentation). Mirrors the legal/login surface — branded
 * header, centered column, footer — so these pages feel first-class rather
 * than like dead stubs. Tokens-only.
 */
export function AccountPageShell({ eyebrow, title, intro, children }: AccountPageShellProps) {
  return (
    <main className="min-h-screen bg-bg-0 text-fg-1">
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-2.5">
            <EarnCoin size={26} />
            <span className="text-[14px] font-semibold tracking-tight">
              FundExecs <span className="text-fg-3">OS</span>
            </span>
          </Link>
          <Link
            href="/command-center"
            className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-4 transition hover:text-fg-2"
          >
            <ArrowLeft size={14} strokeWidth={1.9} aria-hidden />
            Back to the desk
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-4xl px-6 py-12">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-1">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.02em]">{title}</h1>
        {intro ? <p className="mt-3 max-w-2xl text-[14px] leading-7 text-fg-3">{intro}</p> : null}
        <div className="mt-9">{children}</div>
      </article>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-[12px] text-fg-5">
          <span>© {new Date().getFullYear()} FundExecs Technologies. All rights reserved.</span>
          <nav className="flex gap-4">
            <Link href="/help" className="transition hover:text-fg-3">
              Help
            </Link>
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

export default AccountPageShell;
