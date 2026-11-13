\set ON_ERROR_STOP 0
create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p_uid, false); execute 'set role authenticated'; end $$;
reset role;
select case when count(*) = 431 then 'PASS rooms: 430 register rooms + 155 from 0006' else 'FAIL rooms: ' || count(*) end from public.rooms where room_number ~ '^\d{3}$';
select case when not exists (select 1 from public.rooms where room_number between '053' and '057') then 'PASS rooms: 053-057 absent' else 'FAIL rooms 053-057 present' end;
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000e1'), ('00000000-0000-0000-0000-0000000000e2') on conflict do nothing;
insert into public.profiles(id, username, display_name, role, active) values
 ('00000000-0000-0000-0000-0000000000e1','photo_user','Photo User','user',true),
 ('00000000-0000-0000-0000-0000000000e2','photo_other','Other','user',true) on conflict do nothing;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select public.set_my_avatar('00000000-0000-0000-0000-0000000000e1/1.jpg');
select case when avatar_path = '00000000-0000-0000-0000-0000000000e1/1.jpg' then 'PASS avatar: user sets own photo' else 'FAIL avatar own' end from public.profiles where id = '00000000-0000-0000-0000-0000000000e1';
do $$ begin perform public.set_my_avatar('00000000-0000-0000-0000-0000000000e2/x.jpg'); raise notice 'FAIL avatar: other folder accepted'; exception when insufficient_privilege then raise notice 'PASS avatar: other folder refused'; end $$;
update public.profiles set avatar_path = null where id = '00000000-0000-0000-0000-0000000000e2';
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000e1';
reset role;
select case when role = 'user' then 'PASS profile: user cannot make self admin' else 'FAIL self admin' end from public.profiles where id = '00000000-0000-0000-0000-0000000000e1';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select public.set_my_avatar(null);
reset role;
select case when avatar_path is null then 'PASS avatar: removed' else 'FAIL avatar remove' end from public.profiles where id = '00000000-0000-0000-0000-0000000000e1';
set role anon;
do $$ begin perform public.set_my_avatar(null); raise notice 'FAIL anon allowed'; exception when insufficient_privilege then raise notice 'PASS avatar: anonymous refused'; end $$;
reset role;

-- ---------------------------------------------------- 0007: recorder role ----
reset role;
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000f1'), ('00000000-0000-0000-0000-0000000000f2') on conflict do nothing;
insert into public.profiles(id, username, display_name, role, can_enter_data, active) values
 ('00000000-0000-0000-0000-0000000000f1','rec_one','Recorder One','recorder',false,true),
 ('00000000-0000-0000-0000-0000000000f2','solo_admin','Solo Admin','admin',false,true) on conflict do nothing;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select case when public.can_enter() then 'PASS recorder: may enter readings' else 'FAIL recorder cannot enter' end;
select case when not public.can_view() then 'PASS recorder: no report access' else 'FAIL recorder can view' end;
select case when (select count(*) from public.meters) > 0 then 'PASS recorder: sees meters for Daily Entry' else 'FAIL recorder no meters' end;
select case when (select count(*) from public.budgets) = 0 and (select count(*) from public.alerts) = 0 and (select count(*) from public.rooms) = 0 and (select count(*) from public.daily_metrics) = 0
  then 'PASS recorder: budgets, alerts, rooms, occupancy hidden' else 'FAIL recorder sees report data' end;
insert into public.readings (meter_id, reading_date, opening, closing)
  select id, public.local_today() - 45, 10, 12 from public.meters where code = 'TST-ROLL';
reset role;
select case when entered_by = '00000000-0000-0000-0000-0000000000f1' then 'PASS entered_by: recorder saved on insert' else 'FAIL entered_by insert' end
  from public.readings r join public.meters m on m.id = r.meter_id where m.code = 'TST-ROLL' and r.reading_date = public.local_today() - 45;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
update public.readings set closing = 13 where reading_date = public.local_today() - 45 and meter_id = (select id from public.meters where code = 'TST-ROLL');
reset role;
select case when entered_by = '00000000-0000-0000-0000-0000000000f2' then 'PASS entered_by: replaced by admin is recorded' else 'FAIL entered_by update' end
  from public.readings r join public.meters m on m.id = r.meter_id where m.code = 'TST-ROLL' and r.reading_date = public.local_today() - 45;
-- the role can be changed by an administrator; a user cannot set a role
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
update public.profiles set role = 'user' where id = '00000000-0000-0000-0000-0000000000f1';
reset role;
select case when role = 'user' then 'PASS role: admin changed recorder to user' else 'FAIL role change' end from public.profiles where id = '00000000-0000-0000-0000-0000000000f1';
do $$ begin update public.profiles set role = 'boss' where id = '00000000-0000-0000-0000-0000000000f1'; raise notice 'FAIL unknown role accepted';
  exception when check_violation then raise notice 'PASS role: unknown role refused'; end $$;
-- last active administrator
update public.profiles set active = false where role = 'admin' and id <> '00000000-0000-0000-0000-0000000000f2';
do $$ begin update public.profiles set role = 'user' where id = '00000000-0000-0000-0000-0000000000f2'; raise notice 'FAIL last admin demoted';
  exception when check_violation then raise notice 'PASS last admin cannot be demoted'; end $$;

-- 0008: deleting users
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000d1'), ('00000000-0000-0000-0000-0000000000d2'), ('00000000-0000-0000-0000-0000000000d3') on conflict do nothing;
insert into public.profiles(id, username, display_name, role, can_enter_data, active, is_owner) values
 ('00000000-0000-0000-0000-0000000000d1','akram_owner','Owner','admin',true,true,true),
 ('00000000-0000-0000-0000-0000000000d2','temp_rec','Temp Recorder','recorder',false,true,false),
 ('00000000-0000-0000-0000-0000000000d3','plain_user','Plain User','user',false,true,false) on conflict do nothing;
update public.readings set entered_by = '00000000-0000-0000-0000-0000000000d2'
 where reading_date = public.local_today() - 45 and meter_id = (select id from public.meters where code = 'TST-ROLL');
-- a regular user cannot delete anyone
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d3');
do $$ begin perform public.admin_delete_user('00000000-0000-0000-0000-0000000000d2'); raise notice 'FAIL user deleted someone';
  exception when insufficient_privilege then raise notice 'PASS delete user: only administrators'; end $$;
reset role;
-- an administrator deletes the recorder; the reading stays
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select public.admin_delete_user('00000000-0000-0000-0000-0000000000d2');
do $$ begin perform public.admin_delete_user('00000000-0000-0000-0000-0000000000d1'); raise notice 'FAIL owner deleted';
  exception when check_violation then raise notice 'PASS delete user: owner protected'; end $$;
do $$ begin perform public.admin_delete_user('00000000-0000-0000-0000-0000000000f2'); raise notice 'FAIL deleted self';
  exception when check_violation then raise notice 'PASS delete user: not yourself'; end $$;
do $$ begin update public.profiles set active = false where id = '00000000-0000-0000-0000-0000000000d1'; raise notice 'FAIL owner deactivated';
  exception when check_violation then raise notice 'PASS owner cannot be deactivated'; end $$;
reset role;
select case when not exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-0000000000d2')
             and not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000d2')
  then 'PASS delete user: account and profile removed' else 'FAIL delete user' end;
select case when r.closing = 13 and r.entered_by is null then 'PASS delete user: readings kept' else 'FAIL readings after user delete' end
  from public.readings r join public.meters m on m.id = r.meter_id where m.code = 'TST-ROLL' and r.reading_date = public.local_today() - 45;
select case when exists (select 1 from public.audit_log where action = 'DELETE_USER' and old_data->>'username' = 'temp_rec')
  then 'PASS delete user: recorded in audit log' else 'FAIL no audit entry' end;

-- 0009: Tail rooms
select case when (select count(*) from public.rooms where room_number between '701' and '737') = 37
             and (select count(*) from public.rooms where room_number between '801' and '825') = 25
             and exists (select 1 from public.rooms where room_number = '363')
  then 'PASS tail rooms added' else 'FAIL tail rooms' end;

-- ------------------------------------------------- 0010: monthly reports ----
reset role;
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000a9'), ('00000000-0000-0000-0000-0000000000a8') on conflict do nothing;
insert into public.profiles(id, username, display_name, role, active) values
 ('00000000-0000-0000-0000-0000000000a9','report_admin','Report Admin','admin',true),
 ('00000000-0000-0000-0000-0000000000a8','report_rec','Report Recorder','recorder',true) on conflict do nothing;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
insert into public.monthly_reports (month_key, label, path, size_bytes, created_by) values ('2026-10', 'Oct 2026', '2026-10.pdf', 1000, '00000000-0000-0000-0000-0000000000a9');
select case when count(*) = 1 then 'PASS reports: admin adds a monthly report' else 'FAIL reports admin insert' end from public.monthly_reports;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a8');
select case when count(*) = 0 then 'PASS reports: recorder cannot list reports' else 'FAIL recorder sees reports' end from public.monthly_reports;
do $$ begin insert into public.monthly_reports (month_key, label, path) values ('2026-11', 'Nov 2026', 'x.pdf'); raise notice 'FAIL reports: recorder insert accepted'; exception when insufficient_privilege then raise notice 'PASS reports: recorder cannot add'; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select case when count(*) = 1 then 'PASS reports: user can list reports' else 'FAIL user cannot list reports' end from public.monthly_reports;
do $$ begin insert into public.monthly_reports (month_key, label, path) values ('2026-12', 'Dec 2026', 'x.pdf'); raise notice 'FAIL reports: user insert accepted'; exception when insufficient_privilege then raise notice 'PASS reports: user cannot add'; end $$;
reset role;

-- --------------------------------------------- 0011: fixed tariff charges ----
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
insert into public.tariffs (utility, price_per_unit, currency, effective_from, demand, demand_unit, fixed_rate)
values ('chilled', 0.71, 'SAR', '2026-11-01', 2270, 'TR', 163.4);
select case when (select demand * fixed_rate from public.tariffs where utility = 'chilled' and effective_from = '2026-11-01') = 370918.0
  then 'PASS tariffs: admin saves a fixed charge (2270 TR x 163.4)' else 'FAIL tariffs fixed charge' end;
do $$ begin insert into public.tariffs (utility, price_per_unit, effective_from, demand) values ('water', 2.93, '2026-11-01', 890.38);
  raise notice 'FAIL tariffs: demand without fixed rate accepted'; exception when check_violation then raise notice 'PASS tariffs: demand needs a fixed rate'; end $$;
do $$ begin insert into public.tariffs (utility, price_per_unit, effective_from, demand, fixed_rate) values ('water', 2.93, '2026-11-02', -1, 108.3);
  raise notice 'FAIL tariffs: negative demand accepted'; exception when check_violation then raise notice 'PASS tariffs: negative demand refused'; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
do $$ begin insert into public.tariffs (utility, price_per_unit, effective_from, demand, fixed_rate) values ('energy', 0.29, '2026-11-01', 4125, 126.5);
  raise notice 'FAIL tariffs: user insert accepted'; exception when insufficient_privilege then raise notice 'PASS tariffs: user cannot change tariffs'; end $$;
reset role;

-- ------------------------------------------------- 0012: owner activity ----
-- d1 = owner (akram_owner), a9 = another administrator, e2 = user
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select public.log_sign_in('Phone · Chrome');
select public.heartbeat('Daily Entry', 'Phone · Chrome');
select case when count(*) = 0 then 'PASS activity: another admin cannot read sign-ins' else 'FAIL admin reads sign-ins' end from public.sign_in_log;
select case when count(*) = 0 then 'PASS activity: another admin cannot read the change history' else 'FAIL admin reads audit log' end from public.audit_log;
do $$ begin perform public.owner_people(); raise notice 'FAIL activity: admin called owner_people';
  exception when insufficient_privilege then raise notice 'PASS activity: another admin cannot open the people list'; end $$;
do $$ begin insert into public.sign_in_log (username) values ('fake'); raise notice 'FAIL activity: fake sign-in inserted';
  exception when insufficient_privilege then raise notice 'PASS activity: sign-ins cannot be written directly'; end $$;
do $$ begin perform count(*) from public.user_presence; raise notice 'FAIL activity: presence table readable';
  exception when insufficient_privilege then raise notice 'PASS activity: presence table is not readable directly'; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select case when count(*) >= 1 then 'PASS activity: owner sees sign-ins' else 'FAIL owner sign-ins' end from public.sign_in_log where username = 'report_admin';
select case when count(*) > 0 then 'PASS activity: owner sees the change history' else 'FAIL owner audit' end from public.audit_log;
select case when p.page = 'Daily Entry' and p.device = 'Phone · Chrome' and p.last_seen_at > now() - interval '1 minute' and p.sign_ins_30d = 1
  then 'PASS activity: owner sees who is online, on which page and device' else 'FAIL owner_people ' || coalesce(p.page, 'null') end
  from public.owner_people() p where p.username = 'report_admin';
reset role;
insert into public.room_readings (room_number, reading_date, closing, status) values ('001', public.local_today(), 10, 'occupied') on conflict do nothing;
select case when exists (select 1 from public.audit_log where table_name = 'room_readings')
  then 'PASS activity: guest-room readings are recorded in the history' else 'FAIL room readings not audited' end;

-- ============================================== 0013-0016 main meters =======
select case when count(*) = 2 then 'PASS main meters (Main Electricity Meter, ETS Room): the totals on every day, not in the area chart' else 'FAIL main meters: ' || count(*) end
  from public.meters where code in ('EN-MAIN', 'CW-ETS') and include_in_total and counted_from is null and counted_until is null and not in_area_chart;
select case when count(*) = 7 and count(distinct area) = 7 and bool_and(area = name) then 'PASS MDB 1-7: each its own area, in the area chart, not added to the total' else 'FAIL MDB: ' || count(*) end
  from public.meters where code ~ '^EN-MDB[1-7]$' and not include_in_total and in_area_chart;
select case when count(*) = 10 then 'PASS energy outlet meters: information only' else 'FAIL outlets: ' || count(*) end
  from public.meters where code ~ '^EN-[0-9]+$' and not include_in_total and not in_area_chart;
select case when count(*) = 55 then 'PASS chilled zone meters: information only, still in the area chart' else 'FAIL zones: ' || count(*) end
  from public.meters where code ~ '^CW-[0-9]+$' and not include_in_total and in_area_chart;
do $$ begin
  begin update public.meters set counted_from = date '2026-12-01', counted_until = date '2026-11-01' where code = 'EN-MAIN';
    raise notice 'FAIL counted window: "from" after "until" accepted';
  exception when check_violation then raise notice 'PASS counted window: "from" after "until" is refused'; end;
end $$;
insert into public.meters (code, utility, area, name, unit, category) values ('HW-01', 'water', 'Potable Water Room', 'Hot Water', 'm³', 'hot_water') on conflict do nothing;
\i supabase/migrations/0016_main_meters_from_the_start.sql
select case when count(*) = 1 then 'PASS HW-01 in the Potable Water Room is potable (cold) water' else 'FAIL HW-01' end
  from public.meters where code = 'HW-01' and category = 'standard' and name = 'Potable Water';
\i supabase/migrations/0017_mdb_readings_oct_2026.sql
select case when count(*) = 56 and sum(closing) > 0 then 'PASS MDB readings 23-30 Oct loaded (56 rows)' else 'FAIL MDB readings: ' || count(*) end
  from public.readings r join public.meters m on m.id = r.meter_id where m.code ~ '^EN-MDB[1-7]$' and r.reading_date between date '2026-10-23' and date '2026-10-30';
select case when (select consumption from public.v_meter_daily where code = 'EN-MDB1' and reading_date = date '2026-10-24') = 4447.61 then 'PASS MDB 1 consumption on 24 Oct = 4,447.61 kWh' else 'FAIL MDB 1 consumption' end;
insert into public.meters (code, utility, area, name, unit, category) values ('IR-01', 'water', 'Irrigation Room', 'Irrigation Water', 'm³', 'irrigation') on conflict do nothing;
\i supabase/migrations/0018_gas_and_water_totals.sql
select case when (select string_agg(code, ',' order by code) from public.meters where utility = 'water' and include_in_total and code !~ '^TST-') = 'HW-01,IR-01'
  then 'PASS water: total = Potable Water + Irrigation Water' else 'FAIL water totals' end;
select case when (select string_agg(code, ',' order by code) from public.meters where include_in_total and active and code !~ '^TST-') = 'CW-ETS,EN-MAIN,GA-01,HW-01,IR-01'
  then 'PASS one total per utility: Main incomer, ETS Room, LPG Main Gas Meter, Potable + Irrigation' else 'FAIL totals: ' || (select string_agg(code, ',' order by code) from public.meters where include_in_total and active) end;
insert into public.meters (code, utility, area, name, unit) values ('HW-01', 'water', 'Potable Water Room', 'Potable Water', 'm³') on conflict do nothing;
\i supabase/migrations/0019_readings_1_12_nov_2026.sql
select case when count(*) = 132 then 'PASS readings 1-12 Nov loaded (11 meters x 12 days)' else 'FAIL Nov readings: ' || count(*) end
  from public.readings r join public.meters m on m.id = r.meter_id
 where r.reading_date between date '2026-11-01' and date '2026-11-12' and m.code in ('EN-MAIN','EN-MDB1','EN-MDB2','EN-MDB3','EN-MDB4','EN-MDB5','EN-MDB6','EN-MDB7','HW-01','IR-01','CW-ETS');
select case when (select consumption from public.v_meter_daily where code = 'EN-MAIN' and reading_date = date '2026-11-02') = 30152.35
  then 'PASS main meter consumption on 2 Nov = 30,152.35 kWh (= sum of the MDBs)' else 'FAIL main meter 2 Nov' end;
\i supabase/migrations/0020_gas_outlets_nov_2026.sql
select case when (select count(*) from public.meters where utility = 'gas' and unit = 'm³') = 9
             and exists (select 1 from public.meters where code = 'GA-01' and include_in_total and counted_from is null and counted_until is null and not in_area_chart)
             and (select count(*) from public.meters where code ~ '^GA-0[2-9]$' and not include_in_total and in_area_chart) = 8
  then 'PASS gas: m³; LPG Main Gas Meter is the total, the area meters make up the area chart' else 'FAIL gas totals' end;
select case when (select consumption from public.v_meter_daily where code = 'GA-01' and reading_date = date '2026-11-02') = 12.17
             and (select sum(consumption) from public.v_meter_daily where code in ('GA-02','GA-03','GA-04') and reading_date = date '2026-11-02') = 12.17
  then 'PASS gas on 2 Nov = 12.17 m³, main meter = sum of the areas' else 'FAIL gas 2 Nov' end;
select case when (select string_agg(code, ',' order by code) from public.meters where include_in_total and active and code !~ '^TST-') = 'CW-ETS,EN-MAIN,GA-01,HW-01,IR-01'
  then 'PASS one total per utility: Main incomer, ETS Room, LPG Main Gas Meter, Potable + Irrigation' else 'FAIL totals' end;
