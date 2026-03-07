# Task 3: Configure Supabase Auth URLs

## Where
Supabase Dashboard: https://supabase.com/dashboard/project/rvhyotvklfowklzjahdd/auth/url-configuration

## Steps

1. Go to the Supabase Dashboard link above
2. Set **Site URL** to:
   ```
   https://duckcountdown.com
   ```
3. Under **Redirect URLs**, click "Add URL" and add each of these (one at a time):
   ```
   https://duckcountdown.com/auth
   ```
   ```
   https://www.duckcountdown.com/auth
   ```
   ```
   http://localhost:5173/auth
   ```
4. Click **Save**

## Verification
- Site URL shows `https://duckcountdown.com`
- Redirect URLs list shows all 3 URLs above
