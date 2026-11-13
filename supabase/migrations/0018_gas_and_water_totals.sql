-- 0018: which meters make each utility total (Akram, 2026-11-13).
--   Energy        = Main Electricity Meter (EN-MAIN)          (set in 0016)
--   Chilled water = ETS Room (CW-ETS)                         (set in 0016)
--   Gas / LPG     = LPG Main Gas Meter (GA-01); the kitchen and restaurant gas meters are for information
--                   and make up the "Consumption by area" chart
--   Water         = Potable Water (HW-01) + Irrigation Water (IR-01); the outlet water meters (WA-..)
--                   are for information only
-- Information-only meters are never added to a total, so nothing is counted twice. Safe to run more than once.

-- gas
update public.meters set include_in_total = true, counted_from = null, counted_until = null, in_area_chart = false
 where code = 'GA-01';
update public.meters set include_in_total = false, counted_from = null, counted_until = null, in_area_chart = true
 where utility = 'gas' and code ~ '^GA-[0-9]+$' and code <> 'GA-01';

-- water
update public.meters set include_in_total = true, counted_from = null, counted_until = null, in_area_chart = true
 where code in ('HW-01', 'IR-01');
update public.meters set include_in_total = false, counted_from = null, counted_until = null, in_area_chart = false
 where utility = 'water' and code ~ '^WA-[0-9]+$';
