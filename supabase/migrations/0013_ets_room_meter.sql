-- 0013: "ETS Room" meter = total chilled water consumption of the property (Energy Transfer Station).
-- It is informational (include_in_total = false): the chilled water total stays the sum of the zone
-- BTU meters, so nothing is counted twice. The Chilled Water page lists it under "Meters" with its own
-- total, which can be compared with the zone sum. Safe to run more than once.
insert into public.meters (code, utility, area, name, unit, sort_order, include_in_total, active)
select 'CW-ETS', 'chilled', 'ETS Room', 'ETS Room', 'm³', 0, false, true
where not exists (select 1 from public.meters where code = 'CW-ETS' or (utility = 'chilled' and lower(name) = 'ets room'));
