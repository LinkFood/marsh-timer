-- Neutralize the fabricated weather-event rows in hunt_knowledge.
--
-- CORRECTION TO 20260725140000. That migration's header states "Nothing here
-- reached hunt_knowledge ... The brain is clean." That was WRONG. It was
-- concluded from checking content_type='weather-daily', which is the wrong
-- lane. hunt-weather-watchdog:358 also writes each detected event to
-- hunt_knowledge as content_type='weather-event', and the fabricated ones went
-- with them.
--
-- Measured before applying:
--   content like '%-> 0mb%'   1,041   "Pressure drops 1021.3mb: 1021mb -> 0mb"
--   content like '%-> 0F%'      111   "High drops 90F: 90F -> 0F"
--   content like '%low 0F%'     105   "First freeze: low 0F"
--   TOTAL                     1,257   of 12,810 weather-event rows (9.8%)
--
-- These are worse than the table rows they mirror. They are embedded, so vector
-- search retrieves them as if they were observations, and hunt-atlas-spot
-- surfaces them on the live site as "Pressure drop · on file today" chips.
--
-- ── WHY MARK AND UNEMBED RATHER THAN RE-NARRATE OR DELETE ────────────────────
-- The 2026-07-17 stuck-sensor precedent re-narrated and re-embedded, because
-- those rows described real stations whose readings existed and merely needed
-- recomputing from screened data. There is nothing to recompute here: the
-- reading was ABSENT and `?? 0` invented it. No true sentence exists for these
-- rows, so re-narration has nothing to say.
--
-- Deleting would satisfy the product but lose the record of what the machine
-- did, and house law is mark-never-delete-blind. So the row and its text stay
-- as history, and the embedding — which is what makes a row *speak* — is nulled.
-- The embedding is derivable from content, so this is reversible: re-embedding
-- restores it exactly. A null embedding is simply skipped by the IVFFlat index
-- and by every vector RPC.
--
-- Readers that surface these rows by content_type rather than by vector search
-- must ALSO filter metadata->>'artifact'. hunt-atlas-spot is the known one.

UPDATE public.hunt_knowledge
   SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
         'artifact', true,
         'artifact_reason', 'null trailing forecast day coerced to 0 by hunt-weather-watchdog before 2026-07-25'
       ),
       embedding = NULL
 WHERE content_type = 'weather-event'
   AND (content LIKE '%-> 0mb%' OR content LIKE '%-> 0F%' OR content LIKE '%low 0F%');
