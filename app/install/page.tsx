import type { Metadata } from "next";
import Link from "next/link";
import { InstallGuide } from "@/components/pwa/InstallGuide";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "Install the app",
  description: `Add ${SITE_NAME} to your iPhone, iPad, Mac or PC — from Safari, Chrome or Edge, with no app store.`,
};

// Public, self-contained install guide. Linked from the install prompts, the
// desktop download banner and the mobile More menu, and safe to send to a
// colleague: it needs no sign-in, detects the visitor's browser, and keeps
// every platform's steps one tap away.
export default function InstallPage() {
  return (
    <main className="min-h-dvh bg-surface-0 px-4 pb-16 pt-10 text-fg-primary sm:px-6">
      <div className="mx-auto max-w-xl">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-gold-500/30 bg-gold-500/10 font-display text-xl font-semibold text-gold-300">
          FX
        </span>
        <h1 className="mt-5 font-display text-3xl font-semibold tracking-tight">Install {SITE_NAME}</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
          Put the OS on your Home Screen or in your Dock. It launches in its own window, stays signed in, and is
          always the current version — no app store, nothing to download.
        </p>

        <div className="mt-7">
          <InstallGuide />
        </div>

        <p className="mt-8 text-[12.5px] text-fg-muted">
          <Link href="/home" className="text-gold-300 underline-offset-2 hover:underline">
            Back to {SITE_NAME}
          </Link>
        </p>
      </div>
    </main>
  );
}
