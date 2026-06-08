export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-1">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-hairline border-t-fg-1"
        role="status"
        aria-label="Loading"
      />
    </main>
  );
}
