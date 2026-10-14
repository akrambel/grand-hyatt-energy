// HTTP handler for the ESP32 ingest endpoint, written against a small database interface
// so it can be tested without Supabase (see tests/ingest.test.ts).

import { cleanReading, evaluate, LIMITS, sha256Hex, timingSafeEqual, validatePayload } from './logic.ts';
import type { AlertSpec, CleanReading, Thresholds } from './logic.ts';

export interface DeviceRow { id: string; api_key_hash: string; active: boolean }

export interface IngestDb {
  getDevice(deviceId: string): Promise<DeviceRow | null>;
  /** Inserts rows, ignoring duplicates. Returns the measured_at values that were actually inserted. */
  insertReadings(deviceRef: string, rows: CleanReading[]): Promise<string[]>;
  touchDevice(deviceRef: string, info: { seenAt: string; lastReadingAt: string | null; firmware?: string; status: unknown }): Promise<void>;
  getAlertSettings(): Promise<{ thresholds: Thresholds; cooldownMinutes: number }>;
  raiseAlert(spec: AlertSpec, deviceRef: string, cooldownMinutes: number): Promise<void>;
  resolveAlert(dedupeKey: string): Promise<void>;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function handleRequest(req: Request, db: IngestDb, now: () => number = Date.now): Promise<Response> {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Use POST.' });

  const key = req.headers.get('x-device-key') ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!key) return json(401, { ok: false, error: 'Missing device key.' });

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > LIMITS.maxBodyBytes) return json(413, { ok: false, error: 'Payload too large.' });
  const text = await req.text();
  if (text.length > LIMITS.maxBodyBytes) return json(413, { ok: false, error: 'Payload too large.' });

  let body: unknown;
  try { body = JSON.parse(text); } catch { return json(400, { ok: false, error: 'Invalid JSON.' }); }
  const v = validatePayload(body);
  if (!v.ok) return json(400, { ok: false, error: v.error });
  const { payload } = v;

  // Authenticate: same answer for unknown device and wrong key (no device enumeration).
  const device = await db.getDevice(payload.device_id);
  const presented = await sha256Hex(key);
  const valid = device !== null && timingSafeEqual(presented, device.api_key_hash);
  if (!valid || !device) return json(401, { ok: false, error: 'Invalid device credentials.' });
  if (!device.active) return json(403, { ok: false, error: 'Device is disabled.' });

  const nowMs = now();
  const results: Array<{ index: number; status: 'accepted' | 'duplicate' | 'rejected'; reason?: string }> = [];
  const clean: Array<{ index: number; reading: CleanReading }> = [];
  payload.readings.forEach((raw, index) => {
    const c = cleanReading(raw, nowMs);
    if (c.ok) clean.push({ index, reading: c.reading });
    else results.push({ index, status: 'rejected', reason: c.reason });
  });

  // De-duplicate inside the request as well (same measured_at twice).
  const seen = new Set<string>();
  const unique: typeof clean = [];
  for (const c of clean) {
    if (seen.has(c.reading.measured_at)) results.push({ index: c.index, status: 'duplicate' });
    else { seen.add(c.reading.measured_at); unique.push(c); }
  }

  let inserted = new Set<string>();
  if (unique.length) {
    try {
      inserted = new Set(await db.insertReadings(device.id, unique.map((u) => u.reading)));
    } catch (e) {
      console.error('insertReadings failed', e);
      return json(500, { ok: false, error: 'Could not store readings. Retry later.' });
    }
  }
  for (const u of unique) results.push({ index: u.index, status: inserted.has(u.reading.measured_at) ? 'accepted' : 'duplicate' });
  results.sort((a, b) => a.index - b.index);

  const newest = [...unique].sort((a, b) => (a.reading.measured_at < b.reading.measured_at ? 1 : -1))[0]?.reading ?? null;
  try {
    await db.touchDevice(device.id, {
      seenAt: new Date(nowMs).toISOString(),
      lastReadingAt: newest?.measured_at ?? null,
      firmware: payload.firmware,
      status: newest ? { aht20_ok: newest.aht20_ok, bmp280_ok: newest.bmp280_ok } : null,
    });
    if (newest && inserted.has(newest.measured_at)) {
      const { thresholds, cooldownMinutes } = await db.getAlertSettings();
      const ev = evaluate(newest, payload.device_id, thresholds, nowMs);
      for (const spec of ev.raise) await db.raiseAlert(spec, device.id, cooldownMinutes);
      for (const key of ev.resolve) await db.resolveAlert(key);
    }
  } catch (e) {
    // Readings are already stored; alert bookkeeping problems must not make the device retry.
    console.error('post-insert bookkeeping failed', e);
  }

  const count = (s: string) => results.filter((r) => r.status === s).length;
  return json(200, {
    ok: true, server_time: Math.floor(nowMs / 1000),
    accepted: count('accepted'), duplicates: count('duplicate'), rejected: count('rejected'), results,
  });
}
