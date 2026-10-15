-- =============================================================================
-- Migration 0005: water sections (hot water / irrigation) and guest-room chilled water
--
--  1. meters.category   - section of a water meter. 'standard' (potable), 'hot_water', 'irrigation'.
--                         All sections are water meters, so they stay in the water total and use
--                         the water tariff.
--  2. rooms             - the list of guest rooms (room numbers only).
--  3. room_readings     - one row per room and day: cumulative chilled-water (BTU meter) reading and
--                         the room's occupancy status. Consumption = reading(day) - reading(day-1),
--                         calculated by the application exactly like the other meters.
-- Safe to run more than once.
-- =============================================================================

alter table public.meters add column if not exists category text not null default 'standard';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'meters_category_check') then
    alter table public.meters add constraint meters_category_check
      check (category in ('standard', 'hot_water', 'irrigation'));
  end if;
end $$;

create table if not exists public.rooms (
  room_number text primary key check (room_number ~ '^[A-Za-z0-9-]{1,12}$'),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.room_readings (
  room_number  text not null references public.rooms (room_number) on delete cascade on update cascade,
  reading_date date not null check (reading_date between date '2020-01-01' and date '2100-12-31'),
  closing      numeric(18, 3) check (closing is null or closing >= 0),
  opening      numeric(18, 3) check (opening is null or opening >= 0),
  status       text check (status is null or status in ('occupied', 'vacant', 'out_of_order', 'out_of_service', 'house_use')),
  note         text,
  entered_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (room_number, reading_date),
  check (closing is not null or status is not null)
);
create index if not exists room_readings_date_idx on public.room_readings (reading_date);

create or replace function public.before_room_reading_write()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' and new.entered_by is null then
    new.entered_by := auth.uid();
  end if;
  if new.reading_date > public.local_today() then
    raise exception 'Reading date % is in the future', new.reading_date using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists room_readings_before_write on public.room_readings;
create trigger room_readings_before_write before insert or update on public.room_readings
  for each row execute function public.before_room_reading_write();

-- ------------------------------------------------------------ permissions ----
alter table public.rooms         enable row level security;
alter table public.room_readings enable row level security;

revoke all on public.rooms, public.room_readings from anon;
revoke all on public.rooms, public.room_readings from authenticated;
grant select on public.rooms, public.room_readings to authenticated;
grant insert, update, delete on public.rooms to authenticated;
grant insert, update, delete on public.room_readings to authenticated;

drop policy if exists rooms_select on public.rooms;
drop policy if exists rooms_write  on public.rooms;
create policy rooms_select on public.rooms for select to authenticated using (public.is_active_user());
create policy rooms_write  on public.rooms for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists room_readings_select on public.room_readings;
drop policy if exists room_readings_insert on public.room_readings;
drop policy if exists room_readings_update on public.room_readings;
drop policy if exists room_readings_delete on public.room_readings;
create policy room_readings_select on public.room_readings for select to authenticated using (public.is_active_user());
create policy room_readings_insert on public.room_readings for insert to authenticated with check (public.can_enter());
create policy room_readings_update on public.room_readings for update to authenticated
  using (public.can_enter()) with check (public.can_enter());
create policy room_readings_delete on public.room_readings for delete to authenticated using (public.is_admin());
