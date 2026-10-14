import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceState, ambientTemp, sensorTempDelta, stat, findGaps, bucketSecondsFor, thresholdState } from '../src/lib/sensor.ts';

const now = new Date('2026-10-13T12:00:00Z');
test('deviceState', () => {
  assert.equal(deviceState(null, 10, now), 'never');
  assert.equal(deviceState('2026-10-13T11:55:00Z', 10, now), 'online');
  assert.equal(deviceState('2026-10-13T11:45:00Z', 10, now), 'delayed');
  assert.equal(deviceState('2026-10-13T10:00:00Z', 10, now), 'offline');
  assert.equal(deviceState('garbage', 10, now), 'never');
});
test('ambient uses AHT20 only', () => {
  assert.equal(ambientTemp({ aht20_temp_c: 27.4, aht20_ok: true }), 27.4);
  assert.equal(ambientTemp({ aht20_temp_c: 27.4, aht20_ok: false }), null);
  assert.equal(ambientTemp({ aht20_temp_c: null, aht20_ok: true }), null);
  assert.equal(ambientTemp(null), null);
});
test('delta', () => {
  assert.equal(sensorTempDelta({ aht20_temp_c: 27.5, bmp280_temp_c: 27.1 }), 0.4);
  assert.equal(sensorTempDelta({ aht20_temp_c: null, bmp280_temp_c: 27.1 }), null);
});
test('stat ignores nulls', () => {
  assert.deepEqual(stat([1, null, 3, undefined]), { min: 1, max: 3, avg: 2, n: 2 });
  assert.deepEqual(stat([]), { min: null, avg: null, max: null, n: 0 });
});
test('gaps', () => {
  const g = findGaps(['2026-10-13T10:00:00Z', '2026-10-13T10:01:00Z', '2026-10-13T10:30:00Z'], 5);
  assert.equal(g.length, 1);
  assert.equal(g[0].minutes, 29);
});
test('bucket size', () => {
  const h = 3600e3;
  assert.equal(bucketSecondsFor(0, 6 * h), 60);
  assert.ok(bucketSecondsFor(0, 30 * 24 * h) >= 3600);
  assert.equal(bucketSecondsFor(0, 3650 * 24 * h), 86400);
});
test('threshold', () => {
  const t = { enabled: true, min: 18, max: 30 };
  assert.equal(thresholdState(31, t), 'high');
  assert.equal(thresholdState(17, t), 'low');
  assert.equal(thresholdState(25, t), 'ok');
  assert.equal(thresholdState(25, { ...t, enabled: false }), 'off');
  assert.equal(thresholdState(null, t), 'off');
});
