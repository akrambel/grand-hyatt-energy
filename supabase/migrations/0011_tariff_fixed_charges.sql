-- =============================================================================
-- Migration 0011: fixed monthly charges on tariffs
--
-- The utility bills (electricity, potable water, district cooling) have two parts:
--   fixed cost    = diversified demand × fixed tariff          (every month, even with no use)
--   variable cost = metered consumption × variable tariff     (price_per_unit, unchanged)
--   monthly bill  = fixed cost + variable cost
-- Gas keeps a usage price only (leave demand and fixed_rate empty).
-- Safe to run more than once.
-- =============================================================================

alter table public.tariffs add column if not exists demand numeric(14, 3);
alter table public.tariffs add column if not exists demand_unit text;
alter table public.tariffs add column if not exists fixed_rate numeric(14, 4);

alter table public.tariffs drop constraint if exists tariffs_fixed_charge_check;
alter table public.tariffs add constraint tariffs_fixed_charge_check check (
  (demand is null or demand >= 0)
  and (fixed_rate is null or fixed_rate >= 0)
  and ((demand is null) = (fixed_rate is null))          -- both or neither
  and (demand_unit is null or length(demand_unit) <= 12)
);

comment on column public.tariffs.demand      is 'Diversified (contracted) demand billed every month, e.g. 4125 kW, 890.38 m3, 2270 TR';
comment on column public.tariffs.demand_unit is 'Unit of the diversified demand as written on the bill (kW, m3, TR)';
comment on column public.tariffs.fixed_rate  is 'Fixed tariff per demand unit per month (currency of the row); fixed cost = demand x fixed_rate';
