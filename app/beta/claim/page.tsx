import { ClaimView } from './ClaimView';

/**
 * Beta claim page — public route where recipients claim links via email or
 * Google. Requires a valid `token` query param. In Next.js 15/16 `searchParams`
 * is async, so it must be awaited.
 */
export default async function ClaimPage({
  searchParams
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token: rawToken } = await searchParams;
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg-0 px-6">
        <div className="w-full max-w-md rounded-2xl border border-hairline bg-surface-1 p-7 text-center shadow-[var(--shadow-lg)]">
          <h1 className="text-[18px] font-semibold text-fg-1">Invalid link</h1>
          <p className="mt-2 text-[13px] text-fg-4">
            This beta link is missing or invalid. Please check the link and try again.
          </p>
        </div>
      </main>
    );
  }

  return <ClaimView token={token} />;
}
