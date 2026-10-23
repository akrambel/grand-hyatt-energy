import { useState } from 'react';
import { useData } from '../../store/data.ts';
import { supabase, friendlyError } from '../../lib/supabase.ts';
import { Field, Note } from '../../components/ui.tsx';
import { notify } from '../../store/ui.ts';
import type { Settings } from '../../lib/settings.ts';
import { UNIT_CHOICES, UNIT_UTILITIES } from '../../lib/units.ts';
import type { UnitSettings, VolumeUnit } from '../../lib/units.ts';
import { BASE_UNITS, tidy, unitFactor } from '../../lib/units.ts';
import { UTILITIES, UTILITY_INFO } from '../../lib/types.ts';
import type { Utility } from '../../lib/types.ts';

/** EnPI targets are stored per base unit (kWh, m³, L) and edited in the display unit chosen below. */
const targetFactor = (u: Utility, units: UnitSettings): number => (u === 'energy' ? 1 : unitFactor(BASE_UNITS[u], units[u]));

const num = (s: string): number | null => { const t = s.trim(); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };
const txt = (v: number | null) => (v === null ? '' : String(v));

export default function SettingsTab() {
  const { settings, reloadReference } = useData();
  const [s, setS] = useState(() => ({
    th: (['temperature', 'humidity', 'pressure'] as const).map((k) => ({ k, enabled: settings.thresholds[k].enabled, min: txt(settings.thresholds[k].min), max: txt(settings.thresholds[k].max) })),
    cooldown: String(settings.alertCooldownMinutes), offline: String(settings.deviceOfflineMinutes),
    lat: txt(settings.site.latitude), lon: txt(settings.site.longitude), siteName: settings.site.name,
    z: String(settings.anomaly.zThreshold), minSamples: String(settings.anomaly.minSamples), windowDays: String(settings.anomaly.windowDays), anomalyOn: settings.anomaly.enabled,
    jump: String(settings.entry.jumpFactor), units: { ...settings.units } as UnitSettings, roomUnit: settings.roomMeterUnit, caps: settings.lpg.capacityLitres.map(String),
    targets: Object.fromEntries(UTILITIES.map((u) => [u, settings.enpiTargets[u] === null ? '' : String(tidy((settings.enpiTargets[u] as number) * targetFactor(u, settings.units)))])) as Record<Utility, string>,
  }));
  const [busy, setBusy] = useState(false);

  const problems: string[] = [];
  const thr = s.th.map((t) => ({ ...t, minN: num(t.min), maxN: num(t.max) }));
  for (const t of thr) {
    if (Number.isNaN(t.minN) || Number.isNaN(t.maxN)) problems.push(`${t.k}: limits must be numbers.`);
    else if (t.enabled && t.minN === null && t.maxN === null) problems.push(`${t.k}: enter at least one limit or disable the alert.`);
    else if (t.minN !== null && t.maxN !== null && t.minN >= t.maxN) problems.push(`${t.k}: minimum must be lower than maximum.`);
  }
  const cool = num(s.cooldown), off = num(s.offline), z = num(s.z), ms = num(s.minSamples), wd = num(s.windowDays), jf = num(s.jump);
  if (cool === null || Number.isNaN(cool) || cool < 1) problems.push('Alert cooldown must be at least 1 minute.');
  if (off === null || Number.isNaN(off) || off < 2) problems.push('Offline limit must be at least 2 minutes.');
  if (z === null || Number.isNaN(z) || z < 1) problems.push('Anomaly z-score must be ≥ 1.');
  if (ms === null || Number.isNaN(ms) || ms < 7) problems.push('Anomaly minimum history must be at least 7 days.');
  if (wd === null || Number.isNaN(wd) || wd < 7 || (ms !== null && wd < ms)) problems.push('Anomaly window must be ≥ 7 days and ≥ minimum history.');
  if (jf === null || Number.isNaN(jf) || jf < 1.5) problems.push('Entry jump factor must be ≥ 1.5.');
  const lat = num(s.lat), lon = num(s.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon) || (lat !== null && Math.abs(lat) > 90) || (lon !== null && Math.abs(lon) > 180)) problems.push('Coordinates are not valid.');
  const caps = s.caps.map((c) => num(c));
  if (caps.some((c) => c === null || Number.isNaN(c) || (c as number) <= 0)) problems.push('Tank capacities must be positive numbers.');

  const targets = Object.fromEntries(UTILITIES.map((u) => [u, num(s.targets[u])])) as Record<Utility, number | null>;
  if (UTILITIES.some((u) => targets[u] !== null && (Number.isNaN(targets[u]) || (targets[u] as number) <= 0))) problems.push('Targets per occupied room must be positive numbers (or empty for no target).');

  const save = async () => {
    setBusy(true);
    const t = Object.fromEntries(thr.map((x) => [x.k, { enabled: x.enabled, min: x.minN, max: x.maxN }]));
    const rows = [
      { key: 'thresholds', value: t }, { key: 'alert_cooldown_minutes', value: cool }, { key: 'device_offline_minutes', value: off },
      { key: 'site', value: { name: s.siteName, latitude: lat, longitude: lon } },
      { key: 'anomaly', value: { enabled: s.anomalyOn, zThreshold: z, minSamples: ms, windowDays: wd } }, { key: 'entry', value: { jumpFactor: jf } }, { key: 'lpg', value: { capacityLitres: caps } }, { key: 'units', value: s.units }, { key: 'room_meter_unit', value: s.roomUnit },
      { key: 'enpi_targets', value: Object.fromEntries(UTILITIES.map((u) => [u, targets[u] === null ? null : tidy((targets[u] as number) / targetFactor(u, s.units))])) },
    ];
    const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
    setBusy(false);
    if (error) notify.error('Settings not saved', friendlyError(error)); else { notify.success('Settings saved'); await reloadReference(); }
  };
  const label: Record<string, string> = { temperature: 'Temperature (°C)', humidity: 'Relative humidity (%)', pressure: 'Pressure (hPa)' };
  void ({} as Settings);

  return (
    <div className="grid">
      <div className="card"><h3>Environmental alert thresholds</h3>
        <Note kind="info">An alert is raised when a fresh live reading leaves the range. While an alert is open no duplicate is created; after it is resolved a new one can only be raised once the cooldown has passed. Thresholds are disabled until you enable them.</Note>
        {s.th.map((t, i) => (
          <div className="form-grid" key={t.k} style={{ alignItems: 'end', marginBottom: 10 }}>
            <label><input type="checkbox" checked={t.enabled} onChange={(e) => setS({ ...s, th: s.th.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)) })} /> <strong>{label[t.k]}</strong></label>
            <Field label="Minimum"><input className="input mono" inputMode="decimal" value={t.min} onChange={(e) => setS({ ...s, th: s.th.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)) })} /></Field>
            <Field label="Maximum"><input className="input mono" inputMode="decimal" value={t.max} onChange={(e) => setS({ ...s, th: s.th.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)) })} /></Field>
          </div>))}
        <div className="form-grid">
          <Field label="Alert cooldown (minutes)"><input className="input mono" value={s.cooldown} onChange={(e) => setS({ ...s, cooldown: e.target.value })} /></Field>
          <Field label="Device offline after (minutes)"><input className="input mono" value={s.offline} onChange={(e) => setS({ ...s, offline: e.target.value })} /></Field>
        </div></div>
      <div className="card"><h3>Display units</h3>
        <Note kind="info">Choose the unit shown on every page, chart, report and export. Meters keep their own unit in the database; values are converted automatically (1 m³ = 1,000 L), including costs, budgets and daily entry. Tariffs are still entered per m³ (water, chilled water) and per litre (gas).</Note>
        <div className="form-grid">
          {UNIT_UTILITIES.map((u) => (
            <Field key={u} label={u === 'water' ? 'Water (incl. hot water and irrigation)' : u === 'gas' ? 'Gas / LPG' : 'Chilled water'}>
              <select className="input" value={s.units[u]} onChange={(e) => setS({ ...s, units: { ...s.units, [u]: e.target.value as VolumeUnit } })}>
                {UNIT_CHOICES.map((c) => <option key={c} value={c}>{c === 'L' ? 'Litres (L)' : 'Cubic metres (m³)'}</option>)}
              </select>
            </Field>))}
          <Field label="Guest-room BTU meters show" hint="The unit printed on the room meters. Volume units follow the chilled-water display unit above.">
            <select className="input" value={s.roomUnit} onChange={(e) => setS({ ...s, roomUnit: e.target.value })}>
              <option value="m³">Cubic metres (m³)</option><option value="L">Litres (L)</option><option value="kWh">Energy (kWh)</option>
            </select>
          </Field>
        </div></div>
      <div className="card"><h3>Targets per occupied room (EnPI)</h3>
        <Note kind="info">The energy performance indicators management reads: consumption ÷ occupied room-nights (ISO 50001 EnPI). Only days that have both a reading and an occupied-rooms figure count. Leave a box empty for no target.</Note>
        <div className="form-grid">
          {UTILITIES.map((u) => {
            const unit = u === 'energy' ? 'kWh' : s.units[u as keyof UnitSettings];
            return <Field key={u} label={`${UTILITY_INFO[u].label} (${unit} per occupied room)`}><input className="input mono" inputMode="decimal" placeholder="No target" value={s.targets[u]} onChange={(e) => setS({ ...s, targets: { ...s.targets, [u]: e.target.value } })} /></Field>;
          })}
        </div></div>
      <div className="card"><h3>Property & weather</h3>
        <div className="form-grid">
          <Field label="Property name"><input className="input" value={s.siteName} onChange={(e) => setS({ ...s, siteName: e.target.value })} /></Field>
          <Field label="Latitude" hint="Needed only for downloading external weather"><input className="input mono" value={s.lat} onChange={(e) => setS({ ...s, lat: e.target.value })} /></Field>
          <Field label="Longitude"><input className="input mono" value={s.lon} onChange={(e) => setS({ ...s, lon: e.target.value })} /></Field>
        </div></div>
      <div className="card"><h3>Consumption checks</h3>
        <div className="form-grid">
          <label><input type="checkbox" checked={s.anomalyOn} onChange={(e) => setS({ ...s, anomalyOn: e.target.checked })} /> Detect abnormal consumption</label>
          <Field label="Sensitivity (z-score)"><input className="input mono" value={s.z} onChange={(e) => setS({ ...s, z: e.target.value })} /></Field>
          <Field label="Minimum valid history (days)"><input className="input mono" value={s.minSamples} onChange={(e) => setS({ ...s, minSamples: e.target.value })} /></Field>
          <Field label="History window (days)"><input className="input mono" value={s.windowDays} onChange={(e) => setS({ ...s, windowDays: e.target.value })} /></Field>
          <Field label="Entry warning: × recent average"><input className="input mono" value={s.jump} onChange={(e) => setS({ ...s, jump: e.target.value })} /></Field>
        </div></div>
      <div className="card"><h3>LPG tank capacities (litres)</h3>
        <Note kind="warn">Please confirm the real tank capacities. The workbook formulas use different values in different places (4,000 L and 5,000 L); the application uses the values below.</Note>
        <div className="form-grid">{s.caps.map((c, i) => <Field key={i} label={`Tank ${i + 1}`}><input className="input mono" value={c} onChange={(e) => setS({ ...s, caps: s.caps.map((x, j) => (j === i ? e.target.value : x)) })} /></Field>)}</div></div>
      {problems.length > 0 && <Note kind="bad"><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>}
      <div><button className="btn primary" disabled={busy || problems.length > 0} onClick={() => void save()}>Save settings</button></div>
    </div>
  );
}
