-- 0014: Main electricity meter and the seven main distribution boards (MDB 1 to MDB 7).
-- They measure the same energy as the area meters, so they are informational (include_in_total = false):
-- the energy total stays the sum of the area meters and nothing is counted twice. The Energy page lists
-- them under "Meters" with their own totals. They come first in Daily Entry. Safe to run more than once.
insert into public.meters (code, utility, area, name, unit, sort_order, include_in_total, active)
select v.code, 'energy', v.area, v.name, 'kWh', v.sort_order, false, true
from (values
  ('EN-MAIN', 'Main incomer', 'Main Electricity Meter', -8),
  ('EN-MDB1', 'MDB', 'MDB 1', -7), ('EN-MDB2', 'MDB', 'MDB 2', -6), ('EN-MDB3', 'MDB', 'MDB 3', -5),
  ('EN-MDB4', 'MDB', 'MDB 4', -4), ('EN-MDB5', 'MDB', 'MDB 5', -3), ('EN-MDB6', 'MDB', 'MDB 6', -2),
  ('EN-MDB7', 'MDB', 'MDB 7', -1)
) as v(code, area, name, sort_order)
where not exists (select 1 from public.meters m where m.code = v.code or (m.utility = 'energy' and lower(m.name) = lower(v.name)));
