-- =============================================================================
-- Migration 0007: "recorder" role and who entered each reading
--
--  1. profiles.role       - adds 'recorder': a person who only enters daily readings. Recorders can
--                           open Daily Entry and My Account; the database also hides costs, budgets,
--                           occupancy, sensors, alerts and guest rooms from them.
--  2. last administrator  - the last active administrator cannot be demoted or deactivated.
--  3. entered_by          - now records the person who last saved a reading (on insert AND when a
--                           reading is replaced), for meter readings and guest-room readings.
--                           The full history stays in audit_log.
-- Safe to run more than once.
-- =============================================================================

-- ----------------------------------------------------------- 1. the role ----
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'user', 'recorder'));

-- Recorders may always enter readings.
create or replace function public.can_enter()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.active
                    and (p.role in ('admin', 'recorder') or p.can_enter_data))
$$;

-- Active administrators and users: everyone who may look at reports.
create or replace function public.can_view()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.active and p.role in ('admin', 'user'))
$$;
revoke all on function public.can_view() from public, anon;
grant execute on function public.can_view() to authenticated;

-- Reports data: hidden from recorders. (Meters, readings, settings and profile names stay readable,
-- because the Daily Entry page needs them.)
drop policy if exists tariffs_select on public.tariffs;
create policy tariffs_select on public.tariffs for select to authenticated using (public.can_view());
drop policy if exists budgets_select on public.budgets;
create policy budgets_select on public.budgets for select to authenticated using (public.can_view());
drop policy if exists weather_select on public.external_weather;
create policy weather_select on public.external_weather for select to authenticated using (public.can_view());
drop policy if exists metrics_select on public.daily_metrics;
create policy metrics_select on public.daily_metrics for select to authenticated using (public.can_view());
drop policy if exists lpg_select on public.lpg_levels;
create policy lpg_select on public.lpg_levels for select to authenticated using (public.can_view());
drop policy if exists devices_select on public.devices;
create policy devices_select on public.devices for select to authenticated using (public.can_view());
drop policy if exists sensor_select on public.sensor_readings;
create policy sensor_select on public.sensor_readings for select to authenticated using (public.can_view());
drop policy if exists alerts_select on public.alerts;
create policy alerts_select on public.alerts for select to authenticated using (public.can_view());
drop policy if exists alerts_ack on public.alerts;
create policy alerts_ack on public.alerts for update to authenticated
  using (public.can_view()) with check (public.can_view());
drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms for select to authenticated using (public.can_view());
drop policy if exists room_readings_select on public.room_readings;
create policy room_readings_select on public.room_readings for select to authenticated using (public.can_view());

-- ------------------------------------------------ 2. last administrator ----
create or replace function public.keep_one_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active)
     and not exists (select 1 from public.profiles p where p.id <> old.id and p.role = 'admin' and p.active) then
    raise exception 'At least one active administrator is required' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists profiles_keep_one_admin on public.profiles;
create trigger profiles_keep_one_admin before update on public.profiles
  for each row execute function public.keep_one_admin();

-- --------------------------------------------------------- 3. entered_by ----
create or replace function public.before_reading_write()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' and new.entered_by is null then
    new.entered_by := auth.uid();
  elsif tg_op = 'UPDATE' and auth.uid() is not null
        and (new.opening is distinct from old.opening or new.closing is distinct from old.closing) then
    new.entered_by := auth.uid();   -- the person who replaced the values
  end if;
  if new.reading_date > public.local_today() then
    raise exception 'Reading date % is in the future', new.reading_date using errcode = 'check_violation';
  end if;
  if new.opening is not null and new.closing is not null and new.closing < new.opening
     and not exists (select 1 from public.meters m
                      where m.id = new.meter_id and m.rollover_at is not null) then
    -- A decreasing meter is only accepted for meters configured with a rollover value.
    -- (Meter replacements: enter the new meter's opening reading explicitly instead.)
    if coalesce(current_setting('app.allow_negative', true), 'off') <> 'on' then
      raise exception 'Closing reading (%) is lower than opening reading (%)', new.closing, new.opening
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create or replace function public.before_room_reading_write()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' and new.entered_by is null then
    new.entered_by := auth.uid();
  elsif tg_op = 'UPDATE' and auth.uid() is not null
        and (new.closing is distinct from old.closing or new.status is distinct from old.status) then
    new.entered_by := auth.uid();
  end if;
  if new.reading_date > public.local_today() then
    raise exception 'Reading date % is in the future', new.reading_date using errcode = 'check_violation';
  end if;
  return new;
end $$;
