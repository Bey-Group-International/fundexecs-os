# Integration OAuth setup

FundExecs OS connects providers through server-side routes and stores provider
tokens in `private.integration_secrets`. Public `integration_connections` rows
only contain provider status, scopes and non-secret account metadata.

## Google Workspace

Google sign-in and Google Workspace integrations use Supabase Auth's Google
provider. The app requests one read-only consent covering:

- `https://www.googleapis.com/auth/gmail.metadata`
- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/drive.readonly`
- the default `openid`, `email`, `profile` scopes

Enable these APIs in Google Cloud:

- Gmail API
- Google Calendar API
- Google Drive API

In Google Cloud, add the Supabase callback URL as an authorized redirect URI:

```text
https://auth.fundexecs.com/auth/v1/callback
```

Enable Google in Supabase Auth with the Google client ID and client secret. The
app-side redirect target remains:

```text
https://www.fundexecs.com/auth/callback
```

The `/auth/callback` route exchanges the Supabase OAuth code, detects the
integration intent cookie, persists connected rows for Gmail, Google Calendar,
Google Drive, Google Docs and Google Slides, then stores the Google access token
and refresh token privately.

For token refresh during background sync, set these server env vars when they
are available outside Supabase Auth:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

If those are missing and a stored Google token expires, users can reconnect to
mint a fresh token.

## Slack

Create a Slack OAuth app and set its redirect URL to:

```text
https://www.fundexecs.com/api/integrations/slack/callback
```

Set server env vars:

- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `SLACK_USER_SCOPES` (optional; defaults to `im:read im:history users:read users:read.email`)

The connect route sends users through Slack OAuth with a state cookie. The
callback exchanges the code, stores the returned user token privately, and
persists the `slack` connection row.

## Calendly

Create a Calendly OAuth app and set its redirect URL to:

```text
https://www.fundexecs.com/api/integrations/calendly/callback
```

Set server env vars:

- `CALENDLY_CLIENT_ID`
- `CALENDLY_CLIENT_SECRET`
- `CALENDLY_SCOPES` (optional; defaults to `users:read scheduled_events:read`)

Calendly OAuth uses PKCE. The callback exchanges the code, resolves the current
Calendly user, stores access and refresh tokens privately, and persists the
`calendly` connection row.

## Apollo

Apollo connects with an API key entered on the Integrations page. The API key is
POSTed to `/api/integrations/apollo/connect`, stored only in
`private.integration_secrets`, and never written to public metadata.

## Verify

1. Visit `/integrations`.
2. Connect each provider.
3. For connected providers, click `Sync`.
4. Confirm `/api/integrations/{provider}/sync` returns contact and interaction
   counts and that `contacts` / `interactions` are populated.
