-- 0021: potable water = cold water + hot water (Akram, 2026-11-13).
--   Water total = Cold Water + Hot Water + Irrigation Water.
--   * HW-01 (Potable Water Room) is the COLD water meter: all water readings entered so far are cold water.
--   * HW-HOT "Hot Water" is new, in the same room, ready for readings (none yet, so it adds nothing for now).
-- Safe to run more than once.
update public.meters set name = 'Cold Water', category = 'standard', include_in_total = true, in_area_chart = true
 where code = 'HW-01';

insert into public.meters (code, utility, area, name, unit, sort_order, include_in_total, in_area_chart, active, category)
select 'HW-HOT', 'water', 'Potable Water Room', 'Hot Water', 'm³', 0, true, true, true, 'hot_water'
where not exists (select 1 from public.meters where code = 'HW-HOT' or (utility = 'water' and lower(name) = 'hot water'));
