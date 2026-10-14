-- =============================================================================
-- TEST DATA (synthetic, NOT real measurements)
-- Purpose: lets you try every dashboard page before real data exists.
-- Run in: Supabase Dashboard > SQL Editor, on an EMPTY project (or a staging project).
--   * readings are marked  note = 'TEST DATA'
--   * a device "test-device" with fake sensor readings is created (its key is random and unusable)
--   * climate/occupancy rows for the same period are created (room count assumes 300 rooms – an invented number)
-- Remove everything again with supabase/optional/test-data-remove.sql
-- =============================================================================
do $$
declare
  v_to   date := public.local_today() - 1;
  v_from date := public.local_today() - 45;
  v_dev  uuid;
begin
  if exists (select 1 from public.app_settings where key = 'test_data_range') then
    raise exception 'Test data is already loaded. Run test-data-remove.sql first.';
  end if;
  perform set_config('app.skip_audit', 'on', true);

  -- cumulative meter readings
  insert into public.readings (meter_id, reading_date, closing, note, source)
  select m.id, v_from + d.i,
         round((1000 * (m.sort_order + 1)
                + sum(daily.v) over (partition by m.id order by d.i))::numeric, 3),
         'TEST DATA', 'manual'
    from public.meters m
    cross join lateral generate_series(0, v_to - v_from) as d(i)
    cross join lateral (
      select (case m.utility when 'energy' then 400.0 when 'water' then 12.0 when 'gas' then 60.0 else 25.0 end)
             * (0.85 + 0.30 * abs(sin(d.i * 0.7 + m.sort_order)))
             * (case when m.utility = 'energy' and m.sort_order = 3 and v_from + d.i = v_to - 4 then 6.0 else 1.0 end) as v) daily
   where m.active
  on conflict (meter_id, reading_date) do nothing;

  -- daily climate / occupancy (manual-type rows)
  insert into public.daily_metrics (metric_date, avg_temp_c, occupancy_rate, occupied_rooms, guests)
  select v_from + d.i,
         round((29 + 5 * sin(d.i / 6.0))::numeric, 1),
         round((0.60 + 0.25 * sin(d.i / 4.0))::numeric, 4),
         round((0.60 + 0.25 * sin(d.i / 4.0)) * 300),
         round((0.60 + 0.25 * sin(d.i / 4.0)) * 300 * 1.8)
    from generate_series(0, v_to - v_from) as d(i)
  on conflict (metric_date) do nothing;

  -- fake LPG levels
  insert into public.lpg_levels (tank, level_fraction, recorded_at)
  select t, round((0.35 + 0.15 * t)::numeric, 4), now() - interval '1 hour' from generate_series(1, 3) t;

  -- test device + 7 days of fake sensor readings every 10 minutes (UTC timestamps)
  insert into public.devices (device_id, name, location, api_key_hash, firmware_version, last_seen_at, last_reading_at, last_status)
  values ('test-device', 'TEST DEVICE (synthetic data)', 'n/a', encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex'),
          'test', now(), now(), '{"aht20_ok": true, "bmp280_ok": true}')
  returning id into v_dev;

  insert into public.sensor_readings (device_ref, measured_at, aht20_temp_c, aht20_humidity_pct, bmp280_temp_c, bmp280_pressure_hpa)
  select v_dev, t,
         round((27 + 4 * sin(extract(epoch from t) / 86400 * 2 * pi() - 2.0))::numeric, 2),
         round((55 - 12 * sin(extract(epoch from t) / 86400 * 2 * pi() - 2.0))::numeric, 2),
         round((27.4 + 4 * sin(extract(epoch from t) / 86400 * 2 * pi() - 2.0))::numeric, 2),
         round((1008 + 3 * sin(extract(epoch from t) / 259200))::numeric, 2)
    from generate_series(date_trunc('minute', now()) - interval '7 days', date_trunc('minute', now()), interval '10 minutes') t;

  insert into public.app_settings (key, value)
  values ('test_data_range', jsonb_build_object('from', v_from, 'to', v_to));
  raise notice 'Test data loaded for % .. %', v_from, v_to;
end $$;
