// The JSON produced by the firmware (fixture written by firmware/tests/test_core.cpp) must be accepted by the server logic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanReading, validatePayload } from '../supabase/functions/ingest/logic.ts';

const body = JSON.parse(readFileSync(new URL('./fixtures/firmware-payload.json', import.meta.url), 'utf8'));

test('firmware payload passes server validation', () => {
  const v = validatePayload(body);
  assert.equal(v.ok, true);
  if (!v.ok) return;
  assert.equal(v.payload.device_id, 'esp32-01');
  assert.equal(v.payload.readings.length, 3);
});

test('firmware readings are interpreted correctly by the server', () => {
  const now = 1760000060_000; // just after the fixture timestamps (1760000001..3)
  const r = body.readings.map((x: unknown) => cleanReading(x as never, now));
  assert.ok(r.every((x: { ok: boolean }) => x.ok));
  const a = (r[0] as { ok: true; reading: ReturnType<typeof Object> & Record<string, unknown> }).reading;
  assert.equal(a.aht20_temp_c, 27.41);
  assert.equal(a.aht20_humidity_pct, 50.25);
  assert.equal(a.bmp280_temp_c, 27);
  assert.equal(a.bmp280_pressure_hpa, 1008.3);
  assert.equal(a.aht20_ok, true);
  // reading 2: AHT20 absent -> flagged as fault, BMP280 negative temperature kept
  const b = (r[1] as { reading: Record<string, unknown> }).reading;
  assert.equal(b.aht20_ok, false); assert.equal(b.aht20_temp_c, null); assert.equal(b.bmp280_temp_c, -5.4);
  // reading 3: implausible pressure was already filtered by the firmware -> BMP fault
  const c = (r[2] as { reading: Record<string, unknown> }).reading;
  assert.equal(c.bmp280_ok, false); assert.equal(c.bmp280_pressure_hpa, null);
});
