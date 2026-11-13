-- 0020: gas / LPG (Akram, 2026-11-13).
--  * Gas meters are read in m³ (as on the gas sheet). Settings › units still chooses how gas is shown (L or m³).
--  * The LPG Main Gas Meter is the gas total on every day; it equals the sum of the area meters
--    (Main Kitchen, Embers, Drift, Amalfi …), which are for information and make up the area chart.
--  * Readings 1-12 Nov 2026: LPG Main Gas Meter = "Gas Outlets Total" on the sheet, plus Main Kitchen,
--    Embers and Drift (Amalfi was not read).
-- Safe to run more than once.
update public.meters set unit = 'm³' where utility = 'gas' and code ~ '^GA-[0-9]+$';

update public.meters set include_in_total = true, counted_from = null, counted_until = null, in_area_chart = false
 where code = 'GA-01';
update public.meters set include_in_total = false, counted_from = null, counted_until = null, in_area_chart = true
 where utility = 'gas' and code ~ '^GA-[0-9]+$' and code <> 'GA-01';

insert into public.readings (meter_id, reading_date, closing, source)
select m.id, v.reading_date, v.closing, 'import'
from (values
  ('GA-01', date '2026-11-01', 894.59),
  ('GA-01', date '2026-11-02', 906.76),
  ('GA-01', date '2026-11-03', 919.07),
  ('GA-01', date '2026-11-04', 934.94),
  ('GA-01', date '2026-11-05', 947.79),
  ('GA-01', date '2026-11-06', 958.68),
  ('GA-01', date '2026-11-07', 967.25),
  ('GA-01', date '2026-11-08', 975.89),
  ('GA-01', date '2026-11-09', 988.33),
  ('GA-01', date '2026-11-10', 1000.12),
  ('GA-01', date '2026-11-11', 1013.77),
  ('GA-01', date '2026-11-12', 1029.22),
  ('GA-04', date '2026-11-01', 658.73),
  ('GA-02', date '2026-11-01', 161.20),
  ('GA-03', date '2026-11-01', 74.66),
  ('GA-04', date '2026-11-02', 665.77),
  ('GA-02', date '2026-11-02', 163.10),
  ('GA-03', date '2026-11-02', 77.89),
  ('GA-04', date '2026-11-03', 674.35),
  ('GA-02', date '2026-11-03', 165.24),
  ('GA-03', date '2026-11-03', 79.48),
  ('GA-04', date '2026-11-04', 685.79),
  ('GA-02', date '2026-11-04', 167.63),
  ('GA-03', date '2026-11-04', 81.51),
  ('GA-04', date '2026-11-05', 694.42),
  ('GA-02', date '2026-11-05', 170.24),
  ('GA-03', date '2026-11-05', 83.14),
  ('GA-04', date '2026-11-06', 701.23),
  ('GA-02', date '2026-11-06', 172.46),
  ('GA-03', date '2026-11-06', 84.99),
  ('GA-04', date '2026-11-07', 706.26),
  ('GA-02', date '2026-11-07', 174.52),
  ('GA-03', date '2026-11-07', 86.47),
  ('GA-04', date '2026-11-08', 710.69),
  ('GA-02', date '2026-11-08', 177.05),
  ('GA-03', date '2026-11-08', 88.14),
  ('GA-04', date '2026-11-09', 720.04),
  ('GA-02', date '2026-11-09', 179.25),
  ('GA-03', date '2026-11-09', 89.04),
  ('GA-04', date '2026-11-10', 727.75),
  ('GA-02', date '2026-11-10', 181.26),
  ('GA-03', date '2026-11-10', 91.12),
  ('GA-04', date '2026-11-11', 736.94),
  ('GA-02', date '2026-11-11', 183.94),
  ('GA-03', date '2026-11-11', 92.89),
  ('GA-04', date '2026-11-12', 746.81),
  ('GA-02', date '2026-11-12', 187.29),
  ('GA-03', date '2026-11-12', 95.12)
) as v(code, reading_date, closing)
join public.meters m on m.code = v.code
on conflict (meter_id, reading_date) do update set closing = excluded.closing, source = 'import', updated_at = now();
