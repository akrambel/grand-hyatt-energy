\set ON_ERROR_STOP 0
create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p_uid, false); execute 'set role authenticated'; end $$;
reset role;
select case when count(*) = 368 then 'PASS rooms: 368 hotel rooms' else 'FAIL rooms: ' || count(*) end from public.rooms where room_number ~ '^\d{3}$';
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
