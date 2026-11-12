-- 0015: the main meters give the utility totals (Akram, 2026-11-12).
--   Energy total         = Main Electricity Meter (= MDB 1 + … + MDB 7)
--   Chilled water total  = ETS Room
--   Area charts          = MDB 1 … MDB 7 (energy, one area each) and the zone BTU meters (chilled water)
-- History is kept: up to 11 Nov 2026 the totals stay the sum of the old area/zone meters (the readings
-- already entered), from 12 Nov 2026 they come from the main meters. The dates can be changed per meter
-- in Administration › Meters. Run 0013 and 0014 first. Safe to run more than once.

-- 1. new meter settings ------------------------------------------------------
alter table public.meters add column if not exists counted_from  date;   -- counted in the total from this day (empty = always)
alter table public.meters add column if not exists counted_until date;   -- … until this day (empty = no end)
-- shown in "Consumption by area"; when the column is new it copies "counted in total" (what the charts used until now)
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'meters' and column_name = 'in_area_chart') then
    alter table public.meters add column in_area_chart boolean not null default true;
    update public.meters set in_area_chart = include_in_total;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'meters_counted_window_check') then
    alter table public.meters add constraint meters_counted_window_check
      check (counted_from is null or counted_until is null or counted_from <= counted_until);
  end if;
end $$;

-- 2. energy -------------------------------------------------------------------
update public.meters set include_in_total = true, counted_from = date '2026-11-12', counted_until = null, in_area_chart = false, area = 'Main Incomer'
 where code = 'EN-MAIN';
update public.meters set include_in_total = false, counted_from = null, counted_until = null, in_area_chart = true, area = name
 where code ~ '^EN-MDB[1-7]$';
-- the outlet meters (restaurants, kitchen …) are fed by the MDBs: counted until 11 Nov, then for information
update public.meters set counted_until = date '2026-11-11'
 where utility = 'energy' and code ~ '^EN-[0-9]+$' and include_in_total and counted_until is null;
update public.meters set in_area_chart = false where utility = 'energy' and code ~ '^EN-[0-9]+$';

-- 3. chilled water -------------------------------------------------------------
update public.meters set include_in_total = true, counted_from = date '2026-11-12', counted_until = null, in_area_chart = false
 where code = 'CW-ETS';
-- the zone meters stay in the area chart; counted in the total until 11 Nov
update public.meters set counted_until = date '2026-11-11'
 where utility = 'chilled' and code ~ '^CW-[0-9]+$' and include_in_total and counted_until is null;
