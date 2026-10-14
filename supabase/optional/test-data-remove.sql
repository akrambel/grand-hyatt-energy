-- Removes the synthetic data created by test-data.sql (readings marked 'TEST DATA', the test device, its readings,
-- climate rows and LPG levels created for the test period). Do NOT run this if you entered real climate/occupancy
-- data or LPG levels in the same period – those rows cannot be told apart from test rows and would be deleted too.
do $$
declare v_from date; v_to date;
begin
  select (value->>'from')::date, (value->>'to')::date into v_from, v_to from public.app_settings where key = 'test_data_range';
  if v_from is null then raise exception 'No test data marker found – nothing removed.'; end if;
  perform set_config('app.skip_audit', 'on', true);
  delete from public.readings where note = 'TEST DATA';
  delete from public.daily_metrics where metric_date between v_from and v_to;
  delete from public.lpg_levels where recorded_at >= (v_to + 1)::timestamptz - interval '2 days';
  delete from public.devices where device_id = 'test-device';     -- cascades to sensor_readings and alerts
  delete from public.app_settings where key = 'test_data_range';
  raise notice 'Test data removed.';
end $$;
