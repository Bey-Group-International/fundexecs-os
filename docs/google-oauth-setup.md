# Google OAuth setup

How to wire up "Continue with Google" sign-in and the Gmail / Google Calendar
integration sync for FundExecs OS. Sign-in uses Supabase Auth's Google
provider; the same flow mints a `provider_token` that the
`POST /api/integrations/{provider}/sync` endpoint uses against the Google APIs.

## 1. Create a Google Cloud OAuth 2.0 Client

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select
   (or create) a project.
2. Configure the **OAuth consent screen** (APIs & Services -> OAuth consent
   screen): pick **External**, fill in the app name, support email, and
   developer contact. Add the scopes below under "Data access":
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/gmail.metadata`
   - the default `openid`, `email`, `profile` scopes
     While the app is in **Testing**, add each operator's Google account under
     "Test users" (or publish the app).
3. Enable the APIs the scopes require (APIs & Services -> Library):
   - **Google Calendar API**
   - **Gmail API**
4. Go to **APIs & Services -> Credentials -> Create Credentials -> OAuth client
   ID** and choose **Web application**.
5. Under **Authorized redirect URIs**, add the Supabase callback URL — this must
   match the host in `NEXT_PUBLIC_SUPABASE_URL`:

   ```
   https://<project-ref>.supabase.co/auth/v1/callback
   ```

   Replace `<project-ref>` with your Supabase project ref (Supabase dashboard ->
   Project Settings -> General). For this project that is currently:

   ```
   https://emityvdaeiqxtpxdhyky.supabase.co/auth/v1/callback
   ```

   Only use a custom domain here (e.g. `https://api.fundexecs.com/...`) once that
   domain actually resolves to Supabase **and** `NEXT_PUBLIC_SUPABASE_URL` points
   at it. Do **not** point this at the app's `/auth/callback`; that is the
   app-side redirect target, not Google's.

6. Save and copy the generated **Client ID** and **Client secret**.

## 2. Enable Google in Supabase Auth

1. In the Supabase dashboard go to **Authentication -> Providers -> Google**.
2. Toggle **Enable**, then paste the **Client ID** and **Client secret** from
   step 1.
3. Confirm the callback URL Supabase shows matches the redirect URI you added in
   Google Cloud (`https://<project-ref>.supabase.co/auth/v1/callback`).
4. Save. The Calendar + Gmail scopes are requested at sign-in time by the app
   (`signInWithOAuth({ scopes: ... })`), so they do not need to be re-entered in
   Supabase — but they must be approved on the consent screen above.

The app requests offline access with `access_type=offline` and
`prompt=consent` so Google returns a refresh token and a usable
`provider_token` for the sync endpoint.

## 3. App redirect target

After Google authenticates, Supabase redirects back to the app's
`/auth/callback` route, which exchanges the code for a session. The login button
and the integration "Connect & sync" button both set `redirectTo` from
`getSiteURL()` (`lib/site-url.ts`), which prefers `NEXT_PUBLIC_SITE_URL`:

```
redirectTo = `${getSiteURL()}/auth/callback`
```

In production `NEXT_PUBLIC_SITE_URL` is `https://www.fundexecs.com`, so the
redirect target is `https://www.fundexecs.com/auth/callback`.

For production, set **Authentication -> URL Configuration** in Supabase:

- **Site URL**: `https://www.fundexecs.com`
- **Redirect URLs** (allow-list): `https://www.fundexecs.com/auth/callback`,
  `http://localhost:3000/auth/callback`, and a preview wildcard such as
  `https://*-bgi-pres-projects.vercel.app/auth/callback`.

Use the `www` host (the apex `fundexecs.com` 308-redirects to it); pin auth to
that one host so the PKCE code-verifier cookie survives the redirect. Otherwise
Supabase rejects the redirect or the code exchange fails.

## 4. Environment variables (Vercel)

Set these in the Vercel project (Project Settings -> Environment Variables) for
Production, Preview, and Development:

| Variable                        | Value                                              |
| ------------------------------- | -------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | `https://emityvdaeiqxtpxdhyky.supabase.co`         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project anon (publishable) key            |
| `NEXT_PUBLIC_SITE_URL`          | `https://www.fundexecs.com` (canonical app origin) |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase service-role key (used by sync API)       |

The Google client ID/secret live in Supabase Auth (step 2), not in Vercel.

## 5. Verify

1. Visit `/login` and click **Continue with Google**. Approve the Calendar +
   Gmail scopes; you should land on `/command-center` signed in.
2. Visit `/integrations`. For **Gmail** and **Google Calendar**, click
   **Connect & sync**: when not yet connected it runs the Google OAuth flow;
   once connected it POSTs to `/api/integrations/{provider}/sync` and shows the
   synced contact / interaction counts.
3. Non-Google providers (Calendly, Slack, Apollo, Outlook) render a disabled
   **Setup required** control until their own OAuth apps are wired up.
