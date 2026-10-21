-- =============================================================================
-- Migration 0009: the Tail rooms (room register "Number of hotel Rooms - V 3", 2026-10-21)
--
-- Adds the guest rooms that were not in the list yet:
--   Tail L01 701-737 (37) · Tail L02 801-825 (25) · L03 room 363.
-- The register has no room 155 on L01. If 155 was added earlier it is NOT deleted (it may have
-- readings); the Guest Rooms page lists it as "not in the hotel list" and an administrator can
-- remove it there (Manage rooms).
-- Safe to run more than once.
-- =============================================================================
insert into public.rooms (room_number, sort_order)
select lpad(n::text, 3, '0'), n
from (
  select 363 as n union all
  select generate_series(701, 737) union all
  select generate_series(801, 825)
) s
on conflict (room_number) do nothing;
