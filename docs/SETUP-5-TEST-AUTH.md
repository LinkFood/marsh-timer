# Task 5: Test Authentication Flow

## Prerequisites
- Tasks 1-4 must be completed first

## Steps

1. Go to https://duckcountdown.com
2. Click the **Sign In** button in the top-right header
3. You should land on the `/auth` page with a "Continue with Google" button
4. Click **Continue with Google**
5. Sign in with your Google account
6. You should be redirected back to the map view
7. Verify your **avatar** (Google profile photo) appears in the top-right header
8. Click your avatar — a dropdown should show:
   - Your display name
   - Your email
   - A "Sign Out" button
9. Click **Sign Out** — you should return to the signed-out state (Sign In button reappears)

## If Google Sign-In Fails
- Check that the Google OAuth redirect URI in Task 1 exactly matches: `https://rvhyotvklfowklzjahdd.supabase.co/auth/v1/callback`
- Check that the Site URL in Task 3 is `https://duckcountdown.com` (no trailing slash)
- Check that `https://duckcountdown.com/auth` is in the Redirect URLs list in Task 3

## If You Get Redirected to the Wrong Place
The Supabase Site URL or Redirect URLs are misconfigured. Redo Task 3.
