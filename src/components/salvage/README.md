# Salvage

Components pulled from the deleted `/intelligence` page (THE CUT, 2026-07-02), kept for reuse in later increments. Not currently imported anywhere.

- **CountdownClock.tsx** — live ticking countdown to a deadline timestamp. Self-contained.
- **TrackRecord.tsx** — graded-claim accuracy strip (confirmed/partial/missed/false-alarm). Uses `useTrackRecord` hook.
- **FingerprintMatches.tsx** — "this pattern looked like N past setups" fingerprint-similarity list. Self-contained.
- **ArcClaimCard.tsx** — a single claim with its deadline countdown (imports CountdownClock). Court-adjacent.
