// Supabase Edge Function: POST /functions/v1/ingest
// Deployed with JWT verification OFF (see supabase/config.toml) because devices authenticate
// with their own API key (header `x-device-key`), whose SHA-256 is stored in `devices`.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase – never put them in the repo.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleRequest } from './handler.ts';
import type { IngestDb } from './handler.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const db: IngestDb = {
  async getDevice(deviceId) {
    const { data, error } = await supabase.from('devices').select('id, api_key_hash, active').eq('device_id', deviceId).maybeSingle();
    if (error) throw error;
    return data;
  },
  async insertReadings(deviceRef, rows) {
    const { data, error } = await supabase.from('sensor_readings')
      .upsert(rows.map((r) => ({ ...r, device_ref: deviceRef })), { onConflict: 'device_ref,measured_at', ignoreDuplicates: true })
      .select('measured_at');
    if (error) throw error;
    return (data ?? []).map((d: { measured_at: string }) => new Date(d.measured_at).toISOString());
  },
  async touchDevice(deviceRef, info) {
    const patch: Record<string, unknown> = { last_seen_at: info.seenAt, last_status: info.status };
    if (info.lastReadingAt) patch.last_reading_at = info.lastReadingAt;
    if (info.firmware) patch.firmware_version = info.firmware;
    const { error } = await supabase.from('devices').update(patch).eq('id', deviceRef);
    if (error) throw error;
  },
  async getAlertSettings() {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', ['thresholds', 'alert_cooldown_minutes']);
    if (error) throw error;
    const map = new Map((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
    return { thresholds: (map.get('thresholds') ?? {}) as never, cooldownMinutes: Number(map.get('alert_cooldown_minutes') ?? 60) };
  },
  async raiseAlert(spec, deviceRef, cooldownMinutes) {
    const { error } = await supabase.rpc('raise_alert', {
      p_dedupe_key: spec.dedupe_key, p_kind: spec.kind, p_severity: spec.severity, p_title: spec.title,
      p_message: spec.message, p_metric: spec.metric, p_value: spec.value, p_threshold: spec.threshold,
      p_device: deviceRef, p_cooldown_minutes: cooldownMinutes,
    });
    if (error) throw error;
  },
  async resolveAlert(key) {
    const { error } = await supabase.rpc('resolve_alerts', { p_dedupe_key: key });
    if (error) throw error;
  },
};

Deno.serve((req) => handleRequest(req, db));
