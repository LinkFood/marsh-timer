# Task 6: Test AI Chat

## Prerequisites
- Tasks 1-5 must be completed first
- You should be signed in

## Test Anonymous Chat (Incognito)

1. Open https://duckcountdown.com in an **incognito/private browser window**
2. In the bottom panel, find the chat input area
3. Type: `What's duck season in Texas?`
4. Press Enter or click the send button
5. You should get an AI response with a **season card** showing dates and status
6. Try 2 more queries to use up the 3 free daily queries
7. On the 4th query, you should see a rate limit message

## Test Signed-In Chat

1. Go back to your normal browser window (signed in)
2. Try each of these queries one at a time:

**Season query:**
```
What's duck season in Texas?
```
Expected: Text response + green/red season card with dates and bag limits

**Weather query:**
```
Weather for hunting in Texas
```
Expected: Text response + blue weather card with temperature, wind, precipitation

**Solunar query:**
```
Solunar forecast for today
```
Expected: Text response + purple solunar card with moon phase, major/minor feeding times

**Cross-species query:**
```
When does deer season open in Georgia?
```
Expected: Text response about deer season in GA with season card

**General chat:**
```
What's the best time to hunt ducks?
```
Expected: Text response with general hunting advice (no card)

## If Chat Returns Errors
- Check edge function logs: https://supabase.com/dashboard/project/rvhyotvklfowklzjahdd/functions
- Click on `hunt-dispatcher` and check the logs tab
- Common issues:
  - `ANTHROPIC_API_KEY not configured` — add it to Supabase secrets
  - CORS errors in browser console — check that duckcountdown.com is in the allowed origins
