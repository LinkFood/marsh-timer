# Task 1: Create Google OAuth Credentials

## Where
Google Cloud Console: https://console.cloud.google.com/apis/credentials

## Steps

1. Go to the Google Cloud Console link above
2. Select an existing project or create a new one (name doesn't matter, "DuckCountdown" is fine)
3. If creating new: you may need to configure the OAuth Consent Screen first
   - User Type: External
   - App name: Duck Countdown
   - Support email: your email
   - Scopes: just email and profile (defaults)
   - Test users: add your email
   - Save
4. Go to **Credentials** tab
5. Click **Create Credentials > OAuth Client ID**
6. Application type: **Web application**
7. Name: `DuckCountdown`
8. Under **Authorized redirect URIs**, add exactly this URL:
   ```
   https://rvhyotvklfowklzjahdd.supabase.co/auth/v1/callback
   ```
9. Click **Create**
10. Copy the **Client ID** and **Client Secret** — you'll need them in the next task

## Output Needed
- Google OAuth Client ID (looks like `xxxx.apps.googleusercontent.com`)
- Google OAuth Client Secret (looks like `GOCSPX-xxxx`)
