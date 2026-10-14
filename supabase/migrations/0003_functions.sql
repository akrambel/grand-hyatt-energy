-- =============================================================================
-- Migration 0003: views and RPC functions
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_meter_daily – SQL mirror of src/lib/calc.ts (computeMeterDay).
--   consumption = closing - opening, opening = explicit opening, else the
--   previous calendar day's closing of the same meter (the workbook's rule).
-- -----------------------------------------------------------------------------
create or replace view public.v_meter_daily with (security_invoker = true) as
select
  r.meter_id,
  m.code,
  m.utility,
  m.area,
  m.name,
  m.unit,
  m.include_in_total,
  r.reading_date,
  r.closing,
  coalesce(r.opening, p.closing) as opening_effective,
  (r.opening is not null and p.closing is not null and r.opening <> p.closing) as discontinuity,
  case
    when r.closing is null then 'missing_closing'
    when coalesce(r.opening, p.closing) is null then 'missing_opening'
    when r.closing >= coalesce(r.opening, p.closing) then 'ok'
    when m.rollover_at is not null
         and coalesce(r.opening, p.closing) <= m.rollover_at
         and (r.closing + m.rollover_at - coalesce(r.opening, p.closing)) <= m.rollover_at * 0.5
      then 'rollover'
    else 'negative'
  end as status,
  case
    when r.closing is null or coalesce(r.opening, p.closing) is null then null
    when r.closing >= coalesce(r.opening, p.closing) then r.closing - coalesce(r.opening, p.closing)
    when m.rollover_at is not null
         and coalesce(r.opening, p.closing) <= m.rollover_at
         and (r.closing + m.rollover_at - coalesce(r.opening, p.closing)) <= m.rollover_at * 0.5
      then r.closing + m.rollover_at - coalesce(r.opening, p.closing)
    else null
  end as consumption
from public.readings r
join public.meters m on m.id = r.meter_id
left join public.readings p on p.meter_id = r.meter_id and p.reading_date = r.reading_date - 1;

create or replace view public.v_lpg_latest with (security_invoker = true) as
select distinct on (tank) tank, level_fraction, recorded_at, recorded_by
from public.lpg_levels
order by tank, recorded_at desc;

-- -----------------------------------------------------------------------------
-- Sensor statistics (daily min/avg/max from real readings, local calendar day)
-- -----------------------------------------------------------------------------
create or replace function public.sensor_daily_stats(
  p_from date, p_to date, p_device uuid default null, p_tz text default null)
returns table (
  day date, device_ref uuid, samples bigint,
  aht20_temp_avg numeric, aht20_temp_min numeric, aht20_temp_max numeric,
  humidity_avg numeric, humidity_min numeric, humidity_max numeric,
  bmp280_temp_avg numeric, bmp280_temp_min numeric, bmp280_temp_max numeric,
  pressure_avg numeric, pressure_min numeric, pressure_max numeric)
language sql stable security invoker set search_path = public as $$
  with tz as (select coalesce(p_tz, public.setting_text('timezone', 'Asia/Riyadh')) as z)
  select (sr.measured_at at time zone tz.z)::date as day,
         sr.device_ref,
         count(*) as samples,
         round(avg(sr.aht20_temp_c), 2),  min(sr.aht20_temp_c),  max(sr.aht20_temp_c),
         round(avg(sr.aht20_humidity_pct), 2), min(sr.aht20_humidity_pct), max(sr.aht20_humidity_pct),
         round(avg(sr.bmp280_temp_c), 2), min(sr.bmp280_temp_c), max(sr.bmp280_temp_c),
         round(avg(sr.bmp280_pressure_hpa), 2), min(sr.bmp280_pressure_hpa), max(sr.bmp280_pressure_hpa)
  from public.sensor_readings sr, tz
  where sr.measured_at >= (p_from::timestamp at time zone tz.z)
    and sr.measured_at <  ((p_to + 1)::timestamp at time zone tz.z)
    and (p_device is null or sr.device_ref = p_device)
  group by 1, 2
  order by 1
$$;

-- Down-sampled series for charts (avoids shipping 100k raw points to the browser).
create or replace function public.sensor_bucketed(
  p_from timestamptz, p_to timestamptz, p_bucket_seconds integer, p_device uuid default null)
returns table (
  bucket timestamptz, samples bigint,
  aht20_temp_avg numeric, aht20_temp_min numeric, aht20_temp_max numeric,
  humidity_avg numeric, bmp280_temp_avg numeric, pressure_avg numeric)
language sql stable security invoker set search_path = public as $$
  select to_timestamp(floor(extract(epoch from sr.measured_at) / greatest(p_bucket_seconds, 60))
                      * greatest(p_bucket_seconds, 60)) as bucket,
         count(*),
         round(avg(sr.aht20_temp_c), 2), min(sr.aht20_temp_c), max(sr.aht20_temp_c),
         round(avg(sr.aht20_humidity_pct), 2),
         round(avg(sr.bmp280_temp_c), 2),
         round(avg(sr.bmp280_pressure_hpa), 2)
  from public.sensor_readings sr
  where sr.measured_at >= p_from and sr.measured_at < p_to
    and (p_device is null or sr.device_ref = p_device)
  group by 1
  order by 1
$$;

-- -----------------------------------------------------------------------------
-- Device registration (the plain key is returned ONCE, only its SHA-256 is stored)
-- -----------------------------------------------------------------------------
create or replace function public.register_device(p_device_id text, p_name text, p_location text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_key text;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can register devices' using errcode = '42501';
  end if;
  v_key := 'ghrs_' || encode(gen_random_bytes(24), 'hex');
  insert into public.devices (device_id, name, location, api_key_hash)
  values (p_device_id, p_name, p_location, encode(digest(v_key, 'sha256'), 'hex'));
  return v_key;
end $$;

create or replace function public.rotate_device_key(p_device_id text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_key text;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can rotate device keys' using errcode = '42501';
  end if;
  v_key := 'ghrs_' || encode(gen_random_bytes(24), 'hex');
  update public.devices set api_key_hash = encode(digest(v_key, 'sha256'), 'hex')
   where device_id = p_device_id;
  if not found then
    raise exception 'Unknown device %', p_device_id;
  end if;
  return v_key;
end $$;

-- -----------------------------------------------------------------------------
-- Alert deduplication + cooldown (service role / cron only)
--   * An open alert with the same dedupe key suppresses new ones.
--   * After it is resolved, a new alert is suppressed until the cooldown passes
--     (protects against flapping around a threshold).
-- -----------------------------------------------------------------------------
create or replace function public.raise_alert(
  p_dedupe_key text, p_kind text, p_severity text, p_title text, p_message text,
  p_metric text, p_value numeric, p_threshold numeric, p_device uuid,
  p_cooldown_minutes integer default 60)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if exists (select 1 from public.alerts a
              where a.dedupe_key = p_dedupe_key
                and (a.resolved_at is null
                     or a.created_at > now() - make_interval(mins => greatest(p_cooldown_minutes, 0)))) then
    return null;
  end if;
  insert into public.alerts (kind, severity, title, message, metric, value, threshold, device_ref, dedupe_key)
  values (p_kind, p_severity, p_title, p_message, p_metric, p_value, p_threshold, p_device, p_dedupe_key)
  on conflict (dedupe_key) where resolved_at is null do nothing
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.resolve_alerts(p_dedupe_key text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  update public.alerts set resolved_at = now()
   where dedupe_key = p_dedupe_key and resolved_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Device offline watchdog – call from pg_cron (see supabase/optional/) or any scheduler.
create or replace function public.check_device_status()
returns integer language plpgsql security definer set search_path = public as $$
declare
  d record;
  v_minutes integer := coalesce((select (value #>> '{}')::integer from public.app_settings
                                  where key = 'device_offline_minutes'), 10);
  v_cooldown integer := coalesce((select (value #>> '{}')::integer from public.app_settings
                                   where key = 'alert_cooldown_minutes'), 60);
  v_raised integer := 0;
begin
  for d in select id, device_id, name, last_seen_at from public.devices where active loop
    if d.last_seen_at is null or d.last_seen_at < now() - make_interval(mins => v_minutes) then
      if public.raise_alert('offline:' || d.device_id, 'device_offline', 'critical',
           'Sensor device offline: ' || d.name,
           'No data received for more than ' || v_minutes || ' minutes.',
           'last_seen', null, v_minutes, d.id, v_cooldown) is not null then
        v_raised := v_raised + 1;
      end if;
    else
      perform public.resolve_alerts('offline:' || d.device_id);
    end if;
  end loop;
  return v_raised;
end $$;

revoke all on function public.raise_alert(text, text, text, text, text, text, numeric, numeric, uuid, integer) from public, anon, authenticated;
revoke all on function public.resolve_alerts(text) from public, anon, authenticated;
revoke all on function public.check_device_status() from public, anon, authenticated;
grant execute on function public.raise_alert(text, text, text, text, text, text, numeric, numeric, uuid, integer) to service_role;
grant execute on function public.resolve_alerts(text) to service_role;
grant execute on function public.check_device_status() to service_role;

revoke all on function public.register_device(text, text, text) from public, anon;
revoke all on function public.rotate_device_key(text) from public, anon;
grant execute on function public.register_device(text, text, text) to authenticated;
grant execute on function public.rotate_device_key(text) to authenticated;
grant execute on function public.sensor_daily_stats(date, date, uuid, text) to authenticated;
grant execute on function public.sensor_bucketed(timestamptz, timestamptz, integer, uuid) to authenticated;
grant select on public.v_meter_daily, public.v_lpg_latest to authenticated;

-- -----------------------------------------------------------------------------
-- Bulk import (administrator only). One call = one transaction = one chunk.
--   p_kind: 'meters' | 'readings' | 'daily_metrics' | 'budgets' | 'lpg'
--   p_mode: 'overwrite'     – update changed values; blank incoming cells never erase data
--           'skip_existing' – only insert rows / fill empty fields
-- Audit triggers are suppressed for the chunk; the client writes ONE import_log row.
-- -----------------------------------------------------------------------------
create or replace function public.import_rows(p_kind text, p_rows jsonb, p_mode text default 'overwrite')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_in integer := coalesce(jsonb_array_length(p_rows), 0);
  v_ins integer := 0;
  v_upd integer := 0;
  v_unknown integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can import data' using errcode = '42501';
  end if;
  if p_mode not in ('overwrite', 'skip_existing') then
    raise exception 'Unknown import mode %', p_mode;
  end if;
  perform set_config('app.skip_audit', 'on', true);

  if p_kind = 'meters' then
    with up as (
      insert into public.meters (code, utility, area, name, unit, sort_order)
      select x.code, x.utility, x.area, x.name, x.unit, coalesce(x.sort_order, 0)
        from jsonb_to_recordset(p_rows) as x(code text, utility text, area text, name text, unit text, sort_order integer)
      on conflict (code) do nothing
      returning 1)
    select count(*) into v_ins from up;

  elsif p_kind = 'readings' then
    select count(*) into v_unknown from jsonb_to_recordset(p_rows) as x(meter_code text)
     where not exists (select 1 from public.meters m where m.code = x.meter_code);
    with src as (
      select m.id as meter_id, x.reading_date, x.opening, x.closing
        from jsonb_to_recordset(p_rows) as x(meter_code text, reading_date date, opening numeric, closing numeric)
        join public.meters m on m.code = x.meter_code
       where x.opening is not null or x.closing is not null),
    up as (
      insert into public.readings (meter_id, reading_date, opening, closing, source, entered_by)
      select meter_id, reading_date, opening, closing, 'import', auth.uid() from src
      on conflict (meter_id, reading_date) do update
        set opening = coalesce(excluded.opening, public.readings.opening),
            closing = coalesce(excluded.closing, public.readings.closing),
            source = 'import', updated_at = now()
        where p_mode = 'overwrite'
          and (public.readings.opening is distinct from coalesce(excluded.opening, public.readings.opening)
            or public.readings.closing is distinct from coalesce(excluded.closing, public.readings.closing))
      returning (xmax = 0) as inserted)
    select count(*) filter (where inserted), count(*) filter (where not inserted) into v_ins, v_upd from up;

  elsif p_kind = 'daily_metrics' then
    with up as (
      insert into public.daily_metrics (metric_date, avg_temp_c, occupancy_rate, occupied_rooms, guests, updated_by)
      select x.metric_date, x.avg_temp_c, x.occupancy_rate, x.occupied_rooms, x.guests, auth.uid()
        from jsonb_to_recordset(p_rows) as x(metric_date date, avg_temp_c numeric, occupancy_rate numeric,
                                              occupied_rooms integer, guests integer)
       where x.avg_temp_c is not null or x.occupancy_rate is not null
          or x.occupied_rooms is not null or x.guests is not null
      on conflict (metric_date) do update
        set avg_temp_c = case when p_mode = 'overwrite' then coalesce(excluded.avg_temp_c, public.daily_metrics.avg_temp_c)
                              else coalesce(public.daily_metrics.avg_temp_c, excluded.avg_temp_c) end,
            occupancy_rate = case when p_mode = 'overwrite' then coalesce(excluded.occupancy_rate, public.daily_metrics.occupancy_rate)
                                  else coalesce(public.daily_metrics.occupancy_rate, excluded.occupancy_rate) end,
            occupied_rooms = case when p_mode = 'overwrite' then coalesce(excluded.occupied_rooms, public.daily_metrics.occupied_rooms)
                                  else coalesce(public.daily_metrics.occupied_rooms, excluded.occupied_rooms) end,
            guests = case when p_mode = 'overwrite' then coalesce(excluded.guests, public.daily_metrics.guests)
                          else coalesce(public.daily_metrics.guests, excluded.guests) end,
            updated_by = auth.uid(), updated_at = now()
      returning (xmax = 0) as inserted)
    select count(*) filter (where inserted), count(*) filter (where not inserted) into v_ins, v_upd from up;

  elsif p_kind = 'budgets' then
    with up as (
      insert into public.budgets (fiscal_year, month, kind, rooms_sold, occupancy_rate, guests, gas, electricity, water, updated_by)
      select x.fiscal_year, x.month, x.kind, x.rooms_sold, x.occupancy_rate, x.guests, x.gas, x.electricity, x.water, auth.uid()
        from jsonb_to_recordset(p_rows) as x(fiscal_year integer, month integer, kind text, rooms_sold numeric,
                                              occupancy_rate numeric, guests numeric, gas numeric,
                                              electricity numeric, water numeric)
      on conflict (fiscal_year, month, kind) do update
        set rooms_sold = case when p_mode = 'overwrite' then coalesce(excluded.rooms_sold, public.budgets.rooms_sold) else coalesce(public.budgets.rooms_sold, excluded.rooms_sold) end,
            occupancy_rate = case when p_mode = 'overwrite' then coalesce(excluded.occupancy_rate, public.budgets.occupancy_rate) else coalesce(public.budgets.occupancy_rate, excluded.occupancy_rate) end,
            guests = case when p_mode = 'overwrite' then coalesce(excluded.guests, public.budgets.guests) else coalesce(public.budgets.guests, excluded.guests) end,
            gas = case when p_mode = 'overwrite' then coalesce(excluded.gas, public.budgets.gas) else coalesce(public.budgets.gas, excluded.gas) end,
            electricity = case when p_mode = 'overwrite' then coalesce(excluded.electricity, public.budgets.electricity) else coalesce(public.budgets.electricity, excluded.electricity) end,
            water = case when p_mode = 'overwrite' then coalesce(excluded.water, public.budgets.water) else coalesce(public.budgets.water, excluded.water) end,
            updated_by = auth.uid(), updated_at = now()
      returning (xmax = 0) as inserted)
    select count(*) filter (where inserted), count(*) filter (where not inserted) into v_ins, v_upd from up;

  elsif p_kind = 'lpg' then
    with up as (
      insert into public.lpg_levels (tank, level_fraction, recorded_at, recorded_by)
      select x.tank, x.level_fraction, coalesce(x.recorded_at, now()), auth.uid()
        from jsonb_to_recordset(p_rows) as x(tank smallint, level_fraction numeric, recorded_at timestamptz)
       where x.level_fraction is not null
      returning 1)
    select count(*) into v_ins from up;

  else
    raise exception 'Unknown import kind %', p_kind;
  end if;

  return jsonb_build_object('kind', p_kind, 'received', v_in, 'inserted', v_ins, 'updated', v_upd,
                            'unknown_meter', v_unknown,
                            'unchanged', greatest(v_in - v_ins - v_upd - v_unknown, 0));
end $$;

revoke all on function public.import_rows(text, jsonb, text) from public, anon;
grant execute on function public.import_rows(text, jsonb, text) to authenticated;

create or replace function public.log_import(p_filename text, p_mode text, p_summary jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can import data' using errcode = '42501';
  end if;
  select username into v_name from public.profiles where id = auth.uid();
  insert into public.import_log (user_id, username, filename, mode, summary)
  values (auth.uid(), v_name, p_filename, p_mode, p_summary);
end $$;
revoke all on function public.log_import(text, text, jsonb) from public, anon;
grant execute on function public.log_import(text, text, jsonb) to authenticated;
