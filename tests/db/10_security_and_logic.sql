-- =============================================================================
-- Database tests: role permissions (RLS), validation triggers, consumption view,
-- device keys, sensor statistics, alert dedupe/cooldown, bulk import, audit log.
--
-- Run with tests/db/run.sh (needs a scratch PostgreSQL 15+ database).
-- Any failed assertion aborts the script with a non-zero exit code.
-- =============================================================================
\set ON_ERROR_STOP on
\set QUIET on

-- ----------------------------------------------------------- test helpers ----
create or replace function pg_temp.t_assert(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERTION FAILED: %', p_msg; end if;
  raise notice 'PASS: %', p_msg;
end $$;

-- Runs p_sql and asserts it fails (optionally with a given SQLSTATE).
create or replace function pg_temp.t_fails(p_sql text, p_msg text, p_state text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_state is not null and sqlstate <> p_state then
      raise exception 'ASSERTION FAILED: % (got SQLSTATE % / %)', p_msg, sqlstate, sqlerrm;
    end if;
    raise notice 'PASS: % [%]', p_msg, sqlerrm;
    return;
  end;
  raise exception 'ASSERTION FAILED: % (statement succeeded)', p_msg;
end $$;

-- ------------------------------------------------------------------ fixture --
truncate public.readings, public.daily_metrics, public.audit_log, public.import_log,
         public.alerts, public.sensor_readings, public.devices, public.lpg_levels,
         public.budgets, public.profiles cascade;
delete from auth.users;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test'),
  ('00000000-0000-0000-0000-0000000000b1', 'viewer@test'),
  ('00000000-0000-0000-0000-0000000000b2', 'entry@test'),
  ('00000000-0000-0000-0000-0000000000c1', 'disabled@test');
insert into public.profiles (id, username, display_name, role, can_enter_data, active) values
  ('00000000-0000-0000-0000-0000000000a1', 'TestAdmin',  'Test Admin',  'admin', false, true),
  ('00000000-0000-0000-0000-0000000000b1', 'TestViewer', 'Test Viewer', 'user',  false, true),
  ('00000000-0000-0000-0000-0000000000b2', 'TestEntry',  'Test Entry',  'user',  true,  true),
  ('00000000-0000-0000-0000-0000000000c1', 'TestOff',    'Test Off',    'user',  true,  false);

-- A rollover meter for the rollover tests (TEST DATA).
insert into public.meters (code, utility, area, name, unit, rollover_at)
values ('TST-ROLL', 'water', 'Test area', 'Rollover test meter', 'm³', 100000);

select set_config('app.today', public.local_today()::text, false);

-- helper to impersonate a user the way PostgREST does
create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid, false);
  execute 'set role authenticated';
end $$;

-- ====================================================== 1. anonymous access ==
set role anon;
select pg_temp.t_fails($$select * from public.readings$$, 'anon cannot read readings', '42501');
select pg_temp.t_fails($$select * from public.profiles$$, 'anon cannot read profiles', '42501');
select pg_temp.t_fails($$select * from public.sensor_readings$$, 'anon cannot read sensor readings', '42501');
reset role;

-- ================================================= 2. read-only regular user ==
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.t_assert((select count(*) from public.meters) = 85, 'viewer can read meters (84 seeded + 1 test)');
select pg_temp.t_fails(
  $$insert into public.readings (meter_id, reading_date, closing)
    select id, current_date - 2, 100 from public.meters where code = 'EN-01'$$,
  'viewer without permission cannot insert readings', '42501');
select pg_temp.t_fails($$insert into public.daily_metrics (metric_date, avg_temp_c) values (current_date - 2, 30)$$,
  'viewer without permission cannot insert daily metrics', '42501');
update public.app_settings set value = '99' where key = 'device_offline_minutes';
select pg_temp.t_assert((select value from public.app_settings where key = 'device_offline_minutes') = '10',
  'viewer cannot change settings (RLS blocks the update)');
select pg_temp.t_assert((select count(*) from public.audit_log) = 0, 'viewer sees no audit log rows');
select pg_temp.t_fails($$select api_key_hash from public.devices$$, 'viewer cannot read device key hash', '42501');
select pg_temp.t_fails($$select public.register_device('esp32-x', 'X')$$, 'viewer cannot register devices', '42501');
select pg_temp.t_fails($$select public.import_rows('readings', '[]'::jsonb)$$, 'viewer cannot import', '42501');
reset role;

-- ==================================================== 3. data-entry user ======
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
-- Meter reading example from the specification: 500 -> 583 = 83
insert into public.readings (meter_id, reading_date, closing)
  select id, public.local_today() - 3, 500 from public.meters where code = 'WA-01';
insert into public.readings (meter_id, reading_date, closing)
  select id, public.local_today() - 2, 583 from public.meters where code = 'WA-01';
select pg_temp.t_assert(
  (select consumption from public.v_meter_daily v where v.code = 'WA-01' and v.reading_date = public.local_today() - 2) = 83,
  'entry user: 583 - 500 = 83 via v_meter_daily');
select pg_temp.t_assert(
  (select status from public.v_meter_daily v where v.code = 'WA-01' and v.reading_date = public.local_today() - 3) = 'missing_opening',
  'first reading has no consumption (missing_opening), like the workbook');
select pg_temp.t_assert(
  (select entered_by from public.readings limit 1) = '00000000-0000-0000-0000-0000000000b2',
  'entered_by is set from the signed-in user');
select pg_temp.t_fails(
  $$insert into public.readings (meter_id, reading_date, closing)
    select id, public.local_today() + 1, 10 from public.meters where code = 'EN-01'$$,
  'future reading dates are rejected', '23514');
select pg_temp.t_fails(
  $$insert into public.readings (meter_id, reading_date, opening, closing)
    select id, public.local_today() - 1, 900, 800 from public.meters where code = 'EN-02'$$,
  'closing < opening is rejected for a non-rollover meter', '23514');
select pg_temp.t_fails(
  $$insert into public.readings (meter_id, reading_date, closing)
    select id, public.local_today() - 1, -5 from public.meters where code = 'EN-02'$$,
  'negative readings are rejected', '23514');
select pg_temp.t_fails(
  $$insert into public.readings (meter_id, reading_date, closing)
    select id, public.local_today() - 3, 501 from public.meters where code = 'WA-01'$$,
  'duplicate meter/date is rejected', '23505');
update public.readings set closing = 590 where meter_id = (select id from public.meters where code = 'WA-01')
  and reading_date = public.local_today() - 2;
select pg_temp.t_assert(
  (select closing from public.readings r join public.meters m on m.id = r.meter_id
    where m.code = 'WA-01' and r.reading_date = public.local_today() - 2) = 590, 'entry user can update a reading');
delete from public.readings where meter_id = (select id from public.meters where code = 'WA-01');
select pg_temp.t_assert((select count(*) from public.readings) = 2, 'entry user cannot delete readings (RLS hides delete)');
insert into public.daily_metrics (metric_date, avg_temp_c, occupancy_rate, occupied_rooms, guests)
  values (public.local_today() - 2, 31.5, 0.85, 120, 260);
select pg_temp.t_assert((select count(*) from public.daily_metrics) = 1, 'entry user can store daily metrics');
select pg_temp.t_fails($$insert into public.daily_metrics (metric_date, occupancy_rate) values (public.local_today() - 5, 1.7)$$,
  'occupancy above 100% rejected', '23514');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.t_assert((select role from public.profiles where id = '00000000-0000-0000-0000-0000000000b2') = 'user',
  'user cannot escalate own role (update affects no row)');
reset role;

-- =================================================== 4. disabled account ======
select id as en03 from public.meters where code = 'EN-03' \gset
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.t_assert((select count(*) from public.meters) = 0, 'deactivated user sees no data');
select pg_temp.t_fails(
  format($f$insert into public.readings (meter_id, reading_date, closing) values (%L, public.local_today() - 7, 1)$f$, :'en03'),
  'deactivated user cannot enter data', '42501');
reset role;

-- ======================================== 5. consumption rules (view = TS) ====
-- Negative (chain) and rollover handling, using the rollover test meter.
reset role;
insert into public.readings (meter_id, reading_date, closing)
  select id, d, v from public.meters,
  (values (public.local_today() - 5, 99990::numeric), (public.local_today() - 4, 40::numeric),
          (public.local_today() - 3, 20000::numeric)) as x(d, v)
  where code = 'TST-ROLL';
select pg_temp.t_assert(
  (select consumption from public.v_meter_daily where code = 'TST-ROLL' and reading_date = public.local_today() - 4) = 50,
  'rollover: 99990 -> 40 on a 100000 meter = 50');
select pg_temp.t_assert(
  (select status from public.v_meter_daily where code = 'TST-ROLL' and reading_date = public.local_today() - 3) = 'ok',
  'normal increase after rollover is ok');
insert into public.readings (meter_id, reading_date, closing)
  select id, public.local_today() - 6, 500 from public.meters where code = 'EN-04';
insert into public.readings (meter_id, reading_date, closing)
  select id, public.local_today() - 5, 400 from public.meters where code = 'EN-04';
select pg_temp.t_assert(
  (select status from public.v_meter_daily where code = 'EN-04' and reading_date = public.local_today() - 5) = 'negative'
  and (select consumption from public.v_meter_daily where code = 'EN-04' and reading_date = public.local_today() - 5) is null,
  'decreasing chain reading without rollover is flagged negative and excluded');
-- explicit opening (meter replacement) works
insert into public.readings (meter_id, reading_date, opening, closing)
  select id, public.local_today() - 4, 0, 25 from public.meters where code = 'EN-04';
select pg_temp.t_assert(
  (select consumption from public.v_meter_daily where code = 'EN-04' and reading_date = public.local_today() - 4) = 25
  and (select discontinuity from public.v_meter_daily where code = 'EN-04' and reading_date = public.local_today() - 4),
  'explicit opening after replacement: consumption 25 and discontinuity flagged');
-- gap day: no previous-day reading => no consumption (workbook rule)
insert into public.readings (meter_id, reading_date, closing)
  select id, public.local_today() - 1, 700 from public.meters where code = 'EN-04';
select pg_temp.t_assert(
  (select status from public.v_meter_daily where code = 'EN-04' and reading_date = public.local_today() - 1) = 'missing_opening',
  'missing previous day => missing_opening');

-- ======================================================= 6. administrator =====
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
delete from public.readings where meter_id = (select id from public.meters where code = 'WA-01')
  and reading_date = public.local_today() - 3;
select pg_temp.t_assert(
  not exists (select 1 from public.readings r join public.meters m on m.id = r.meter_id
               where m.code = 'WA-01' and r.reading_date = public.local_today() - 3),
  'admin can delete readings');
update public.profiles set can_enter_data = true where username = 'TestViewer';
select pg_temp.t_assert((select can_enter_data from public.profiles where username = 'TestViewer'),
  'admin can authorise a user for data entry');
update public.profiles set can_enter_data = false where username = 'TestViewer';
select pg_temp.t_assert((select count(*) from public.audit_log) > 0, 'admin can read the audit log');
select pg_temp.t_assert(
  exists (select 1 from public.audit_log where table_name = 'readings' and action = 'DELETE' and username = 'TestAdmin'),
  'audit log records who deleted a reading');
-- tariffs, budgets, settings
insert into public.tariffs (utility, price_per_unit, effective_from) values ('energy', 0.18, '2026-10-01');
update public.app_settings set value = '15' where key = 'device_offline_minutes';
select pg_temp.t_assert((select value from public.app_settings where key = 'device_offline_minutes') = '15', 'admin can change settings');
update public.app_settings set value = '10' where key = 'device_offline_minutes';

-- device registration: key shown once, only SHA-256 stored
create temp table _k as select public.register_device('esp32-test-01', 'Test ESP32', 'Lab') as k;
grant select on _k to authenticated;
select pg_temp.t_assert((select k from _k) like 'ghrs\_%', 'register_device returns a prefixed API key');
reset role;
select pg_temp.t_assert(
  (select api_key_hash from public.devices where device_id = 'esp32-test-01')
    = encode(extensions.digest((select k from _k), 'sha256'), 'hex'),
  'stored hash equals SHA-256 of the key (key itself is not stored)');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.t_assert((select count(*) from public.devices) = 1, 'admin can list devices (without hash column)');
select pg_temp.t_fails($$select api_key_hash from public.devices$$, 'even admins cannot select the key hash from the client', '42501');
create temp table _k2 as select public.rotate_device_key('esp32-test-01') as k;
grant select on _k2 to authenticated;
select pg_temp.t_assert((select k from _k2) <> (select k from _k), 'rotate_device_key issues a different key');
reset role;

-- =========================================================== 7. sensors =======
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.t_fails(
  $$insert into public.sensor_readings (device_ref, measured_at, aht20_temp_c)
    select id, now(), 25 from public.devices$$, 'clients cannot insert sensor readings', '42501');
reset role;
set role service_role;
insert into public.sensor_readings (device_ref, measured_at, aht20_temp_c, aht20_humidity_pct, bmp280_temp_c, bmp280_pressure_hpa)
select d.id, ts, t, h, t + 0.4, p
  from public.devices d,
       (values (timestamptz '2026-10-10 06:00:00+00', 30.0::numeric, 50.0::numeric, 1008.0::numeric),
               (timestamptz '2026-10-10 12:00:00+00', 36.0, 40.0, 1005.0),
               (timestamptz '2026-10-10 20:50:00+00', 32.0, 45.0, 1006.0),   -- 23:50 local
               (timestamptz '2026-10-10 21:10:00+00', 28.0, 60.0, 1010.0)) as x(ts, t, h, p);   -- next local day (00:10)
select pg_temp.t_fails(
  $$insert into public.sensor_readings (device_ref, measured_at, aht20_temp_c)
    select id, timestamptz '2026-10-10 06:00:00+00', 31 from public.devices$$,
  'duplicate (device, measured_at) is rejected', '23505');
select pg_temp.t_fails(
  $$insert into public.sensor_readings (device_ref, measured_at, aht20_humidity_pct)
    select id, timestamptz '2026-10-11 06:00:00+00', 140 from public.devices$$,
  'humidity above 100 % rejected by constraint', '23514');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.t_assert(
  (select count(*) from public.sensor_daily_stats('2026-10-10', '2026-10-11')) = 2,
  'daily stats split at LOCAL midnight (UTC+3): 2 local days');
select pg_temp.t_assert(
  (select aht20_temp_avg from public.sensor_daily_stats('2026-10-10', '2026-10-10')) = 32.67
  and (select aht20_temp_min from public.sensor_daily_stats('2026-10-10', '2026-10-10')) = 30
  and (select aht20_temp_max from public.sensor_daily_stats('2026-10-10', '2026-10-10')) = 36
  and (select samples from public.sensor_daily_stats('2026-10-10', '2026-10-10')) = 3,
  'daily avg/min/max computed from the 3 real readings of 10 Oct (local)');
select pg_temp.t_assert(
  (select pressure_avg from public.sensor_daily_stats('2026-10-11', '2026-10-11')) = 1010,
  'next local day only contains the 00:10 reading');
select pg_temp.t_assert(
  (select count(*) from public.sensor_bucketed('2026-10-10 00:00+00', '2026-10-11 00:00+00', 3600)) = 4,
  'bucketed series groups readings into hourly buckets');
reset role;

-- ================================================ 8. alert dedupe + cooldown ==
set role service_role;
select pg_temp.t_assert(public.raise_alert('t:high', 'temperature', 'warning', 'High', 'm', 'temp', 40, 30, null, 60) is not null,
  'first alert is created');
select pg_temp.t_assert(public.raise_alert('t:high', 'temperature', 'warning', 'High', 'm', 'temp', 41, 30, null, 60) is null,
  'duplicate of an open alert is suppressed');
select pg_temp.t_assert(public.resolve_alerts('t:high') = 1, 'alert resolves when the value is back in range');
select pg_temp.t_assert(public.raise_alert('t:high', 'temperature', 'warning', 'High', 'm', 'temp', 42, 30, null, 60) is null,
  'cooldown suppresses a re-alert right after resolution (anti-flapping)');
select pg_temp.t_assert(public.raise_alert('t:high', 'temperature', 'warning', 'High', 'm', 'temp', 42, 30, null, 0) is not null,
  'with cooldown 0 a new alert is raised');
-- offline watchdog
update public.devices set last_seen_at = now() - interval '2 hours';
select pg_temp.t_assert(public.check_device_status() = 1, 'watchdog raises a device_offline alert');
select pg_temp.t_assert(public.check_device_status() = 0, 'watchdog does not repeat the open offline alert');
update public.devices set last_seen_at = now();
select public.check_device_status();
select pg_temp.t_assert(
  (select resolved_at is not null from public.alerts where dedupe_key like 'offline:%'), 'offline alert resolves when device returns');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.t_fails($$select public.raise_alert('x','other','info','t','m',null,null,null,null,1)$$,
  'clients cannot call raise_alert', '42501');
update public.alerts set acknowledged_at = now(), acknowledged_by = auth.uid() where dedupe_key = 't:high';
select pg_temp.t_assert(exists (select 1 from public.alerts where acknowledged_at is not null), 'any user can acknowledge alerts');
select pg_temp.t_fails($$update public.alerts set title = 'hacked'$$, 'users cannot edit alert text', '42501');
reset role;

-- ======================================================== 9. bulk import ======
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
create temp table _audit_before as select count(*) as n from public.audit_log;
grant select on _audit_before to authenticated;
select public.import_rows('readings',
  jsonb_build_array(
    jsonb_build_object('meter_code', 'EN-05', 'reading_date', '2026-10-01', 'closing', 1000),
    jsonb_build_object('meter_code', 'EN-05', 'reading_date', '2026-10-02', 'closing', 1120.5),
    jsonb_build_object('meter_code', 'NOPE-99', 'reading_date', '2026-10-02', 'closing', 5)),
  'overwrite') as r \gset
select pg_temp.t_assert((:'r'::jsonb ->> 'inserted')::int = 2 and (:'r'::jsonb ->> 'unknown_meter')::int = 1,
  'import inserts 2 rows and reports 1 unknown meter');
select public.import_rows('readings',
  jsonb_build_array(jsonb_build_object('meter_code', 'EN-05', 'reading_date', '2026-10-02', 'closing', 1120.5)),
  'overwrite') as r2 \gset
select pg_temp.t_assert((:'r2'::jsonb ->> 'unchanged')::int = 1 and (:'r2'::jsonb ->> 'updated')::int = 0, 'importing the same value again is "unchanged"');
select public.import_rows('readings',
  jsonb_build_array(jsonb_build_object('meter_code', 'EN-05', 'reading_date', '2026-10-02', 'closing', 1130)),
  'skip_existing') as r3 \gset
select pg_temp.t_assert((select closing from public.readings r join public.meters m on m.id = r.meter_id
                          where m.code = 'EN-05' and r.reading_date = '2026-10-02') = 1120.5,
  'skip_existing keeps the existing value');
select public.import_rows('readings',
  jsonb_build_array(jsonb_build_object('meter_code', 'EN-05', 'reading_date', '2026-10-02', 'closing', 1130)),
  'overwrite') as r4 \gset
select pg_temp.t_assert((:'r4'::jsonb ->> 'updated')::int = 1, 'overwrite updates the changed reading');
select public.import_rows('readings',
  jsonb_build_array(jsonb_build_object('meter_code', 'EN-05', 'reading_date', '2026-10-02')), 'overwrite') as r5 \gset
select pg_temp.t_assert((select closing from public.readings r join public.meters m on m.id = r.meter_id
                          where m.code = 'EN-05' and r.reading_date = '2026-10-02') = 1130,
  'blank cells in an import never erase stored data');
select public.import_rows('daily_metrics',
  '[{"metric_date":"2026-10-01","avg_temp_c":33.4,"occupancy_rate":0.5,"occupied_rooms":80,"guests":150}]', 'overwrite');
select public.import_rows('budgets',
  '[{"fiscal_year":2026,"month":10,"kind":"budget","gas":1000,"electricity":50000,"water":900}]', 'overwrite');
select public.import_rows('lpg', '[{"tank":1,"level_fraction":0.45},{"tank":2,"level_fraction":0.8}]', 'overwrite');
select pg_temp.t_assert((select count(*) from public.v_lpg_latest) = 2, 'LPG import stored 2 tank levels');
select pg_temp.t_assert((select count(*) from public.audit_log) = (select n from _audit_before),
  'bulk import does not flood the audit log');
select public.log_import('test.xlsx', 'overwrite', '{"ok": true}');
select pg_temp.t_assert((select count(*) from public.import_log) = 1, 'import is logged once');
select pg_temp.t_fails($$select public.import_rows('readings', '[{"meter_code":"EN-05","reading_date":"2999-01-01","closing":1}]')$$,
  'importing a future-dated reading is rejected', '23514');
reset role;

-- ============================================================ 10. seed data ====
select pg_temp.t_assert((select count(*) from public.meters where code like 'EN-%') = 10, 'seed: 10 energy meters');
select pg_temp.t_assert((select count(*) from public.meters where code like 'WA-%') = 10, 'seed: 10 water meters');
select pg_temp.t_assert((select count(*) from public.meters where code like 'GA-%') = 9,  'seed: 9 gas meters');
select pg_temp.t_assert((select count(*) from public.meters where code like 'CW-%') = 55, 'seed: 55 chilled-water meters');

-- ================================ 11. water sections and guest-room chilled water ==
select pg_temp.t_assert((select count(*) from public.meters where category = 'standard') = (select count(*) from public.meters),
  'all existing meters default to the standard section');
select pg_temp.t_fails($$insert into public.meters (code, utility, area, name, unit, category) values ('TST-BAD','water','a','b','m³','swimming')$$,
  'unknown water section is rejected', '23514');
insert into public.meters (code, utility, area, name, unit, category) values
  ('TST-HOT', 'water', 'Test', 'Hot water test meter', 'm³', 'hot_water'),
  ('TST-IRR', 'water', 'Test', 'Irrigation test meter', 'm³', 'irrigation');
select pg_temp.t_assert((select count(*) from public.meters where category in ('hot_water','irrigation')) = 2, 'hot water and irrigation meters can be created');

-- rooms: administrators manage the room list, viewers cannot
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.rooms (room_number, sort_order) values ('1001', 1), ('1002', 2), ('1003', 3);
select pg_temp.t_fails($$insert into public.rooms (room_number) values ('bad room!')$$, 'invalid room number is rejected', '23514');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.t_assert((select count(*) from public.rooms) = 3, 'viewer can read the room list');
select pg_temp.t_fails($$insert into public.rooms (room_number) values ('2001')$$, 'viewer cannot add rooms', '42501');
select pg_temp.t_fails($$insert into public.room_readings (room_number, reading_date, closing, status) values ('1001', public.local_today() - 1, 10, 'occupied')$$,
  'viewer without permission cannot enter room readings', '42501');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.t_fails($$insert into public.rooms (room_number) values ('2001')$$, 'entry user cannot add rooms', '42501');
insert into public.room_readings (room_number, reading_date, closing, status) values
  ('1001', public.local_today() - 2, 500, 'occupied'), ('1001', public.local_today() - 1, 583, 'occupied'),
  ('1002', public.local_today() - 1, 40, 'vacant');
select pg_temp.t_assert((select count(*) from public.room_readings) = 3, 'entry user can save room readings and status');
select pg_temp.t_assert((select entered_by from public.room_readings limit 1) = '00000000-0000-0000-0000-0000000000b2', 'room readings record who entered them');
select pg_temp.t_fails($$insert into public.room_readings (room_number, reading_date, closing, status) values ('1003', public.local_today() + 1, 5, 'vacant')$$,
  'future-dated room readings are rejected', '23514');
select pg_temp.t_fails($$insert into public.room_readings (room_number, reading_date, closing, status) values ('1003', public.local_today() - 1, 5, 'sleeping')$$,
  'unknown room status is rejected', '23514');
select pg_temp.t_fails($$insert into public.room_readings (room_number, reading_date) values ('1003', public.local_today() - 1)$$,
  'a room row needs a reading or a status', '23514');
select pg_temp.t_fails($$insert into public.room_readings (room_number, reading_date, closing, status) values ('9999', public.local_today() - 1, 5, 'vacant')$$,
  'unknown room number is rejected', '23503');
delete from public.room_readings;
select pg_temp.t_assert((select count(*) from public.room_readings) = 3, 'entry user cannot delete room readings (RLS blocks it)');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
delete from public.room_readings where room_number = '1002';
select pg_temp.t_assert((select count(*) from public.room_readings) = 2, 'administrator can delete room readings');
reset role;

\echo ALL DATABASE TESTS PASSED
