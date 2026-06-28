import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "production",
  tracesSampleRate: 0.05,
  sendDefaultPii: false,
  enabled: process.env.NODE_ENV === "production",
  beforeSend(event) {
    if (event.user?.email) delete event.user.email;
    if (event.user?.ip_address) delete event.user.ip_address;
    if (event.user?.username) delete event.user.username;
    return event;
  },
});
