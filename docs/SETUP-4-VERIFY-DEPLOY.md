# Task 4: Verify Vercel Deploy

## Where
- Vercel Dashboard: https://vercel.com (check marsh-timer project)
- Live site: https://duckcountdown.com

## Steps

1. Go to Vercel Dashboard and confirm the latest deploy completed successfully (green checkmark)
2. Visit https://duckcountdown.com
3. Hard refresh the page (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows) to bust any cached version
4. Verify these things are visible:
   - Map loads in **satellite view** with **3D terrain** (mountains/hills visible)
   - **Sign In** button appears in the top-right header area (next to the search icon)
   - Bottom panel has a **chat input** area below the season cards
   - County boundary lines appear when you zoom into a state

## If Map Doesn't Load
Check that `VITE_MAPBOX_TOKEN` is set in Vercel environment variables. If you change it, you must push a file change to trigger a rebuild (Vite bakes env vars at build time).

## If Bottom Panel Looks Wrong
Hard refresh. The old cached version won't have the chat layout.
