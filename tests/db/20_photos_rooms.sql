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
