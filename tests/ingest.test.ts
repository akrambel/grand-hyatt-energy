import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../supabase/functions/ingest/handler.ts';
import type { IngestDb } from '../supabase/functions/ingest/handler.ts';
import { cleanReading, evaluate, sha256Hex } from '../supabase/functions/ingest/logic.ts';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const KEY = 'ghrs_testkey123';

async function makeDb(over: Partial<IngestDb> = {}) {
  const stored = new Map<string, any>();
  const alerts: any[] = []; const resolved: string[] = []; const touches: any[] = [];
  const db: IngestDb = {
    async getDevice(id) { return id === 'esp32-test' ? { id: 'dev-1', api_key_hash: await sha256Hex(KEY), active: true } : null; },
    async insertReadings(_d, rows) { const ins: string[] = []; for (const r of rows) if (!stored.has(r.measured_at)) { stored.set(r.measured_at, r); ins.push(r.measured_at); } return ins; },
    async touchDevice(_d, info) { touches.push(info); },
    async getAlertSettings() { return { thresholds: { temperature: { enabled: true, min: 18, max: 30 }, humidity: { enabled: true, min: 30, max: 70 } }, cooldownMinutes: 60 }; },
    async raiseAlert(spec) { alerts.push(spec); },
    async resolveAlert(k) { resolved.push(k); },
    ...over,
  };
  return { db, stored, alerts, resolved, touches };
}
const req = (body: unknown, headers: Record<string, string> = { 'x-device-key': KEY }, method = 'POST') =>
  new Request('https://x/ingest', { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined });
const reading = (ts: number, over: any = {}) => ({ ts, aht20: { temp_c: 25.1, humidity_pct: 48, ok: true }, bmp280: { temp_c: 25.6, pressure_hpa: 1009.2, ok: true }, ...over });
const sec = (ms: number) => Math.floor(ms / 1000);

test('stores a valid reading, returns server time and touches the device', async () => {
  const t = await makeDb();
  const res = await handleRequest(req({ device_id: 'esp32-test', firmware: '1.0.0', readings: [reading(sec(NOW - 5000))] }), t.db, () => NOW);
  const body = await res.json();
  assert.equal(res.status, 200); assert.equal(body.accepted, 1); assert.equal(body.server_time, sec(NOW));
  assert.equal(t.stored.size, 1); assert.equal(t.touches[0].firmware, '1.0.0');
});

test('authentication: missing key, wrong key and unknown device all give 401; wrong method 405', async () => {
  const t = await makeDb();
  const b = { device_id: 'esp32-test', readings: [reading(sec(NOW))] };
  assert.equal((await handleRequest(req(b, {}), t.db, () => NOW)).status, 401);
  assert.equal((await handleRequest(req(b, { 'x-device-key': 'wrong' }), t.db, () => NOW)).status, 401);
  assert.equal((await handleRequest(req({ ...b, device_id: 'nope-123' }), t.db, () => NOW)).status, 401);
  assert.equal((await handleRequest(req(null, {}, 'GET'), t.db, () => NOW)).status, 405);
  assert.equal(t.stored.size, 0);
});

test('disabled device is refused with 403', async () => {
  const t = await makeDb({ async getDevice() { return { id: 'd', api_key_hash: await sha256Hex(KEY), active: false }; } });
  assert.equal((await handleRequest(req({ device_id: 'esp32-test', readings: [reading(sec(NOW))] }), t.db, () => NOW)).status, 403);
});

test('bad payloads: invalid JSON, empty batch, oversize batch, bad device id', async () => {
  const t = await makeDb();
  const raw = new Request('https://x', { method: 'POST', headers: { 'x-device-key': KEY }, body: '{oops' });
  assert.equal((await handleRequest(raw, t.db, () => NOW)).status, 400);
  assert.equal((await handleRequest(req({ device_id: 'esp32-test', readings: [] }), t.db, () => NOW)).status, 400);
  const many = Array.from({ length: 101 }, (_, i) => reading(sec(NOW) - i));
  assert.equal((await handleRequest(req({ device_id: 'esp32-test', readings: many }), t.db, () => NOW)).status, 400);
  assert.equal((await handleRequest(req({ device_id: 'x', readings: [reading(sec(NOW))] }), t.db, () => NOW)).status, 400);
});

test('duplicates (resend after a lost response) are reported, not stored twice', async () => {
  const t = await makeDb();
  const payload = { device_id: 'esp32-test', readings: [reading(sec(NOW - 60000)), reading(sec(NOW - 60000)), reading(sec(NOW - 30000))] };
  const first = await (await handleRequest(req(payload), t.db, () => NOW)).json();
  assert.deepEqual([first.accepted, first.duplicates], [2, 1]);
  const again = await (await handleRequest(req(payload), t.db, () => NOW)).json();
  assert.deepEqual([again.accepted, again.duplicates], [0, 3]);
  assert.equal(t.stored.size, 2);
});

test('delayed backlog after an outage is accepted in one batch, in order', async () => {
  const t = await makeDb();
  const readings = Array.from({ length: 50 }, (_, i) => reading(sec(NOW - 3600_000 + i * 60_000)));
  const body = await (await handleRequest(req({ device_id: 'esp32-test', readings }), t.db, () => NOW)).json();
  assert.equal(body.accepted, 50);
  assert.equal(t.touches[0].lastReadingAt, new Date(NOW - 3600_000 + 49 * 60_000).toISOString());
});

test('timestamps: unsynchronised clock (1970) and far-future values are rejected, per reading', async () => {
  const t = await makeDb();
  const body = await (await handleRequest(req({ device_id: 'esp32-test',
    readings: [reading(12), reading(sec(NOW + 3600_000)), reading(sec(NOW - 1000)), { aht20: { temp_c: 1 } }] }), t.db, () => NOW)).json();
  assert.deepEqual(body.results.map((r: any) => r.reason ?? r.status), ['timestamp_not_synchronised', 'timestamp_in_future', 'accepted', 'missing_timestamp']);
});

test('implausible or failed sensor values are stored as NULL with ok=false (no invented data)', () => {
  const c: any = cleanReading({ ts: sec(NOW), aht20: { temp_c: 120, humidity_pct: 50 }, bmp280: { temp_c: 25, pressure_hpa: 1000, ok: false } }, NOW);
  assert.equal(c.reading.aht20_ok, false); assert.equal(c.reading.aht20_temp_c, null);
  assert.equal(c.reading.bmp280_ok, false); assert.equal(c.reading.bmp280_pressure_hpa, null);
  const good: any = cleanReading({ ts: new Date(NOW).toISOString(), aht20: { temp_c: 24.123, humidity_pct: 40 }, bmp280: { temp_c: 24.9, pressure_hpa: 1013.25 } }, NOW);
  assert.equal(good.reading.aht20_temp_c, 24.12); assert.ok(good.reading.aht20_ok && good.reading.bmp280_ok);
});

test('threshold alerts: raised for fresh readings, resolved when back in range, never for stale backlog', async () => {
  const t = await makeDb();
  const hot = reading(sec(NOW - 1000), { aht20: { temp_c: 36, humidity_pct: 50, ok: true } });
  await handleRequest(req({ device_id: 'esp32-test', readings: [hot] }), t.db, () => NOW);
  assert.ok(t.alerts.some((a) => a.dedupe_key === 'esp32-test:temperature:high' && a.value === 36));
  assert.ok(t.resolved.includes('esp32-test:temperature:low'));
  const t2 = await makeDb();
  await handleRequest(req({ device_id: 'esp32-test', readings: [reading(sec(NOW - 1000))] }), t2.db, () => NOW);
  assert.equal(t2.alerts.length, 0); assert.ok(t2.resolved.includes('esp32-test:temperature:high'));
  const t3 = await makeDb();
  await handleRequest(req({ device_id: 'esp32-test', readings: [{ ...hot, ts: sec(NOW - 3 * 3600_000) }] }), t3.db, () => NOW);
  assert.equal(t3.alerts.length, 0, 'stale readings never raise alerts');
});

test('sensor faults raise a critical alert and disabled thresholds raise nothing', () => {
  const r: any = cleanReading({ ts: sec(NOW), aht20: { ok: false }, bmp280: { temp_c: 25, pressure_hpa: 1000 } }, NOW);
  const ev = evaluate(r.reading, 'd1', {}, NOW);
  assert.ok(ev.raise.some((a) => a.kind === 'sensor_fault' && a.dedupe_key === 'd1:fault:AHT20' && a.severity === 'critical'));
  assert.ok(!ev.raise.some((a) => a.kind === 'temperature'));
});

test('database failure returns 500 so the device keeps its buffer', async () => {
  const t = await makeDb({ async insertReadings() { throw new Error('db down'); } });
  const res = await handleRequest(req({ device_id: 'esp32-test', readings: [reading(sec(NOW))] }), t.db, () => NOW);
  assert.equal(res.status, 500);
});

test('alert bookkeeping errors do not make the device resend stored readings', async () => {
  const t = await makeDb({ async getAlertSettings() { throw new Error('settings down'); } });
  const res = await handleRequest(req({ device_id: 'esp32-test', readings: [reading(sec(NOW - 100))] }), t.db, () => NOW);
  assert.equal(res.status, 200);
});
