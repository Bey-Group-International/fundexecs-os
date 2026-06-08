import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg-1 px-6 text-center text-fg-1">
      <p className="text-sm font-medium text-fg-4">404</p>
      <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 max-w-md text-sm text-fg-4">
        The page you are looking for does not exist or has been moved.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-xl border border-hairline bg-surface-1 px-5 py-2 text-sm font-medium text-fg-1 transition hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
      >
        Back home
      </Link>
    </main>
  );
}
