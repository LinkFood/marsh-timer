# DuckCountdown Hunting OS — Full Setup Playbook

Everything you need to do manually to get auth + chat working. Do these in order. Each task has the exact URL, exact steps, and exact values to enter.

---

## TASK 1: Create Google OAuth Credentials

### Go here:
https://console.cloud.google.com/apis/credentials

### What to do:

1. **Select or create a project.** If you don't have one, click "Select a project" at the top, then "New Project." Name it `DuckCountdown`. Click Create. Wait for it to finish, then make sure it's selected.

2. **Configure the OAuth Consent Screen** (required before creating credentials).
   - In the left sidebar, click **OAuth consent screen**
   - If asked, select **User Type: External**, then click Create
   - Fill in:
     - App name: `Duck Countdown`
     - User support email: your Gmail address
     - Developer contact email: your Gmail address
   - Click **Save and Continue**
   - On the Scopes page, click **Save and Continue** (defaults are fine — email and profile)
   - On the Test Users page, click **Add Users**, enter your Gmail address, click **Save and Continue**
   - Click **Back to Dashboard**

3. **Create the OAuth Client ID.**
   - In the left sidebar, click **Credentials**
   - Click **+ Create Credentials** at the top
   - Select **OAuth client ID**
   - Application type: **Web application**
   - Name: `DuckCountdown`
   - Leave "Authorized JavaScript origins" empty
   - Under **Authorized redirect URIs**, click **+ Add URI** and paste exactly:
     ```
     https://rvhyotvklfowklzjahdd.supabase.co/auth/v1/callback
     ```
   - Click **Create**

4. **Copy the credentials.** A popup will show your Client ID and Client Secret. Copy both and save them somewhere — you need them in Task 2.
   - Client ID looks like: `123456789-abcdefg.apps.googleusercontent.com`
   - Client Secret looks like: `GOCSPX-xxxxxxxxxxxxxxxx`

---

## TASK 2: Enable Google Provider in Supabase

### Go here:
https://supabase.com/dashboard/project/rvhyotvklfowklzjahdd/auth/providers

### What to do:

1. Scroll down to find **Google** in the list of providers
2. Click on it to expand
3. Toggle the **Enabled** switch to ON
4. Paste your **Client ID** from Task 1 into the "Client ID (for OAuth)" field
5. Paste your **Client Secret** from Task 1 into the "Client Secret (for OAuth)" field
6. Do NOT change anything else — leave "Skip nonce check" unchecked, leave "Allow unverified email" unchecked
7. Click **Save**

### Verify:
The Google row should show a green enabled indicator.

---

## TASK 3: Set Auth Redirect URLs in Supabase

### Go here:
https://supabase.com/dashboard/project/rvhyotvklfowklzjahdd/auth/url-configuration

### What to do:

1. **Site URL** — Change this field to:
   ```
   https://duckcountdown.com
   ```
   (Delete whatever is there now and replace it)

2. **Redirect URLs** — Add these three URLs one at a time. For each one, click "Add URL", paste it, and confirm:
   ```
   https://duckcountdown.com/auth
   ```
   ```
   https://www.duckcountdown.com/auth
   ```
   ```
   http://localhost:5173/auth
   ```

3. Click **Save**

### Verify:
- Site URL field shows `https://duckcountdown.com`
- Redirect URLs section shows all 3 URLs listed above

---

## TASK 4: Publish the OAuth Consent Screen (IMPORTANT)

If you skip this, only the test users you added can sign in. To let anyone sign in:

### Go here:
https://console.cloud.google.com/apis/credentials/consent

### What to do:

1. Look at the **Publishing status** section
2. If it says "Testing", click **Publish App**
3. A confirmation dialog will appear — click **Confirm**
4. Status should change to "In production"

**Note:** Google may show a warning that unverified apps show a warning screen. That's fine — users will see a "Google hasn't verified this app" screen but can click "Advanced" > "Go to Duck Countdown (unsafe)" to proceed. This is normal for small apps. You can submit for verification later if you want to remove that screen.

---

## TASK 5: Verify the Frontend Deploy

### Go here:
https://duckcountdown.com

### What to do:

1. Hard refresh the page: **Cmd+Shift+R** (Mac) or **Ctrl+Shift+R** (Windows)
2. Check these things:
   - [ ] Map loads in satellite view (aerial imagery, not dark/flat)
   - [ ] 3D terrain visible (mountains/hills have depth)
   - [ ] **Sign In** button visible in the top-right of the header bar
   - [ ] Chat input area visible at the bottom of the panel (expand the bottom panel if collapsed)
   - [ ] When you zoom into a state, county boundary lines appear

If the map is flat/dark instead of satellite, the old cached version is loading. Try an incognito window.

---

## TASK 6: Test Sign In

### What to do:

1. On https://duckcountdown.com, click the **Sign In** button in the header
2. You should land on `/auth` — a page with a Google sign-in button
3. Click **Continue with Google**
4. Sign in with the Gmail account you added as a test user in Task 1
5. If you see "Google hasn't verified this app":
   - Click **Advanced**
   - Click **Go to Duck Countdown (unsafe)**
   - This is normal for development — not actually unsafe
6. After signing in, you should redirect back to the map
7. Check:
   - [ ] Your Google profile photo appears as an avatar in the top-right header
   - [ ] Clicking the avatar shows a dropdown with your name, email, and "Sign Out"
   - [ ] Clicking Sign Out returns you to the signed-out state

---

## TASK 7: Test Anonymous Chat

### What to do:

1. Open https://duckcountdown.com in an **incognito/private window** (so you're not signed in)
2. Expand the bottom panel if needed
3. In the chat input, type:
   ```
   What's duck season in Texas?
   ```
4. Press Enter
5. Check:
   - [ ] You get an AI text response about Texas duck season
   - [ ] A season card appears with dates, status, and bag limit info
   - [ ] The response takes 2-5 seconds (not instant — it's calling Claude)

If you get an error, check the edge function logs:
https://supabase.com/dashboard/project/rvhyotvklfowklzjahdd/functions
Click `hunt-dispatcher` > Logs tab

---

## TASK 8: Test Signed-In Chat

### What to do:

1. Go back to your normal browser (signed in from Task 6)
2. Try each of these queries:

**Season query:**
```
When does duck season open in Arkansas?
```
Expected: Text response + season card(s) with dates

**Weather query:**
```
What's the weather like for hunting in Texas?
```
Expected: Text response + blue weather card with temp/wind/precip

**Solunar query:**
```
What's the solunar forecast?
```
Expected: Text response + purple solunar card with moon phase and feeding times

**General query:**
```
What's the best time of day to hunt ducks?
```
Expected: Text response with general hunting advice (no card)

3. Check:
   - [ ] All 4 query types return responses
   - [ ] Cards render with colored borders and icons
   - [ ] No error messages in the chat

---

## TASK 9: Seed the Knowledge Base (Optional but Recommended)

This embeds all state facts and regulation links into the vector search database. Makes the AI significantly smarter.

### What to do:

1. Open Terminal

2. Get your service role key:
   ```bash
   cd ~/marsh-timer
   npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd 2>/dev/null | grep service_role
   ```
   Copy the long JWT string (starts with `eyJ...`)

3. Get your Voyage API key:
   - Go to: https://supabase.com/dashboard/project/rvhyotvklfowklzjahdd/settings/vault
   - Find `VOYAGE_API_KEY` in the secrets list
   - Click to reveal and copy the value

4. Run the seed script (replace the placeholder values with your real keys):
   ```bash
   cd ~/marsh-timer
   SUPABASE_URL=https://rvhyotvklfowklzjahdd.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=PASTE_SERVICE_ROLE_KEY_HERE \
   VOYAGE_API_KEY=PASTE_VOYAGE_KEY_HERE \
   deno run --allow-net --allow-env scripts/seed-knowledge.ts
   ```

5. If you don't have Deno installed:
   ```bash
   curl -fsSL https://deno.land/install.sh | sh
   ```
   Then run the command from step 4 again.

6. You should see output showing progress as it embeds each entry. Takes 2-5 minutes.

### Verify:
Go to https://supabase.com/dashboard/project/rvhyotvklfowklzjahdd/editor and open the `hunt_knowledge` table. It should have rows with data in the `embedding` column.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Google sign-in shows "Error 400: redirect_uri_mismatch" | The redirect URI in Task 1 doesn't exactly match. Go back to Google Cloud Console > Credentials > edit your OAuth client > check the redirect URI is exactly `https://rvhyotvklfowklzjahdd.supabase.co/auth/v1/callback` |
| Google sign-in loops back to /auth without signing in | Supabase Site URL is wrong. Go back to Task 3 and verify it's `https://duckcountdown.com` with no trailing slash |
| Chat returns "Sorry, I hit an error" | Check function logs at https://supabase.com/dashboard/project/rvhyotvklfowklzjahdd/functions — click hunt-dispatcher > Logs. Common issue: ANTHROPIC_API_KEY not in Supabase secrets |
| Map shows dark/flat instead of satellite | Old cache. Hard refresh (Cmd+Shift+R) or try incognito. If still flat, check VITE_MAPBOX_TOKEN is set in Vercel env vars |
| "Failed to fetch" error in chat | CORS issue or function not deployed. Verify hunt-dispatcher is deployed: https://supabase.com/dashboard/project/rvhyotvklfowklzjahdd/functions should show hunt-dispatcher in the list |
| Sign In button doesn't appear | Vercel hasn't deployed the latest push. Check https://vercel.com for deploy status |
| Seed script fails with "module not found" | Make sure you're running from `~/marsh-timer` directory and have Deno installed |

---

## Done?

Once Tasks 1-8 pass, the Hunting OS is fully live:
- Map with satellite + 3D + county boundaries
- Google sign in/out
- AI chat with weather, solunar, season, and general queries
- Rate limiting (3/day anonymous, 50/day signed in)
- Conversation persistence for signed-in users

Task 9 (knowledge seeding) can be done anytime — it just makes the search/chat smarter.
