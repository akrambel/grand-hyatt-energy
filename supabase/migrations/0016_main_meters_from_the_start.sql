-- 0016: the main meters count from the start (Akram, 2026-11-13).
-- The readings are entered on the main meters (Main Electricity Meter, ETS Room) from October, while the
-- outlet / zone meters have no readings. So:
--   * Main Electricity Meter and ETS Room are the totals for every day (no start date);
--   * the outlet energy meters and the chilled-water zone meters are for information only (never added,
--     so they can be read later without counting twice); the zones stay in the area chart;
--   * HW-01 in the Potable Water Room is cold potable water, not hot water.
-- Safe to run more than once.
update public.meters set include_in_total = true, counted_from = null, counted_until = null
 where code in ('EN-MAIN', 'CW-ETS');
update public.meters set include_in_total = false, counted_from = null, counted_until = null
 where (utility = 'energy' and code ~ '^EN-[0-9]+$') or (utility = 'chilled' and code ~ '^CW-[0-9]+$');
update public.meters set category = 'standard', name = 'Potable Water'
 where code = 'HW-01' and area = 'Potable Water Room' and name = 'Hot Water';
update public.meters set category = 'standard'
 where code = 'HW-01' and area = 'Potable Water Room';
