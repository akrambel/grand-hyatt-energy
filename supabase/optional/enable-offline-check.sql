-- OPTIONAL: automatic "sensor offline" alerts (runs the watchdog every 5 minutes).
-- 1. Supabase dashboard > Database > Extensions > enable "pg_cron".
-- 2. Run this script once in the SQL editor.
-- Without it the dashboard still shows the live online/offline status of every device; this only
-- adds a stored alert (notification bell + history) when a device stops sending.
select cron.schedule('ghrs-device-watchdog', '*/5 * * * *', $$select public.check_device_status();$$);

-- To remove it later:
-- select cron.unschedule('ghrs-device-watchdog');
