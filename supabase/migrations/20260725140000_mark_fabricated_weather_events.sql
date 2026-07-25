-- Mark the events the watchdog fabricated from missing forecast days.
--
-- Faucet fixed in the same session (hunt-weather-watchdog, commit 262ef85):
-- Open-Meteo's 16-day forecast carries only 15 non-null days, and the detectors
-- coerced the trailing null with `?? 0`. Every daily run therefore invented a
-- full slate of events on the final day and stamped them severity high.
--
-- Mark, never delete blind — the same discipline as
-- 20260705120000_mark_storm_v1_superseded.sql. Readers filter; the rows stay as
-- the record of what the machine did.
--
-- ── WHY THE SIGNATURE IS SAFE ────────────────────────────────────────────────
-- Each family is identified by a physically impossible value, and every matched
-- row independently carries the mechanical fingerprint: event_date is exactly 15
-- days after created_at, i.e. the last index of the forecast array.
--
--   pressure_drop  new_pressure = 0 mb   — a fall to vacuum. 993 of 4,847 rows.
--   cold_front     new_high     = 0 F    — e.g. "High drops 90F: 90F -> 0F".
--                                          53 of 473 rows.
--   first_freeze   low_f        = 0 F    — 49 of 557 rows. Verified beyond the
--                                          impossible-value test because a real
--                                          0F low is conceivable in winter:
--                                          all 49 fall in April (16), May (13)
--                                          and July (20) — a July first freeze
--                                          does not exist — all 49 have the
--                                          15-day lag, and the coldest genuine
--                                          first_freeze row in the table is 11F.
--
-- 1,095 rows total. The surface already read-guards them; this makes the
-- artifact explicit in the data so no future reader has to rediscover it.
-- Nothing here reached hunt_knowledge: the embed path reads yesterday and
-- forecast offsets 1-2, never the trailing index, and a search for weather-daily
-- rows containing "pressure:0mb" or "temp:0/0F" returns zero. The brain is clean.

UPDATE public.hunt_weather_events
   SET details = details || jsonb_build_object(
         'artifact', true,
         'artifact_reason', 'null trailing forecast day coerced to 0 by hunt-weather-watchdog before 2026-07-25'
       )
 WHERE event_type = 'pressure_drop'
   AND details->>'new_pressure' = '0';

UPDATE public.hunt_weather_events
   SET details = details || jsonb_build_object(
         'artifact', true,
         'artifact_reason', 'null trailing forecast day coerced to 0 by hunt-weather-watchdog before 2026-07-25'
       )
 WHERE event_type = 'cold_front'
   AND details->>'new_high' = '0';

UPDATE public.hunt_weather_events
   SET details = details || jsonb_build_object(
         'artifact', true,
         'artifact_reason', 'null trailing forecast day coerced to 0 by hunt-weather-watchdog before 2026-07-25'
       )
 WHERE event_type = 'first_freeze'
   AND details->>'low_f' = '0';
