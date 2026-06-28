import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "production",
  tracesSampleRate: 0.1,
  replaysOnErrorSampleRate: 0.5,
  replaysSessionSampleRate: 0.01,
  integrations: [
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
  ],
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    /^Non-Error promise rejection/,
    /^Network request failed/,
    /^Load failed/,
  ],
  beforeSend(event) {
    if (event.user?.email) delete event.user.email;
    if (event.user?.ip_address) delete event.user.ip_address;
    if (event.user?.username) delete event.user.username;
    return event;
  },
  // Only send in production; suppress noise in local dev
  enabled: process.env.NODE_ENV === "production",
});
