// lib/integrations/adapters/app-url.ts
// Base URL for links native adapters hand back as DispatchResult.reference
// (meeting rooms, envelope wizards). Allow-listed hostnames only, so a
// misconfigured env var can't mint links that point operators off-platform.
export function getAppUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";
  try {
    const { hostname } = new URL(raw);
    const safe =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".fundexecs.com") ||
      hostname.endsWith(".vercel.app");
    return safe ? raw.replace(/\/$/, "") : "http://localhost:3000";
  } catch {
    return "http://localhost:3000";
  }
}
