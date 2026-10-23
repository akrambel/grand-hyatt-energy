// Meter QR stickers. Each code opens Daily Entry on that meter (today's date), so the recorder only
// types the closing reading. Printed from a separate window as an A4 sheet of labels.
import QRCode from 'qrcode';
import type { Meter } from './types.ts';
import { UTILITY_INFO } from './types.ts';
import { logoUrl } from '../config/env.ts';

/** Link written in the QR code: this website's address + #/entry?meter=CODE. */
export function meterEntryUrl(code: string, base = `${window.location.origin}${window.location.pathname}`): string {
  return `${base}#/entry?meter=${encodeURIComponent(code)}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export async function stickerSheetHtml(meters: Meter[], property: string): Promise<string> {
  const cells = await Promise.all(meters.map(async (m) => {
    const svg = await QRCode.toString(meterEntryUrl(m.code), { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#2a2123', light: '#ffffff' } });
    return `<div class="s"><div class="q">${svg}</div><div class="t"><img src="${esc(new URL(logoUrl(), window.location.href).href)}" alt=""><b>${esc(m.name)}</b><span>${esc(m.area)}</span><span>${esc(UTILITY_INFO[m.utility].label)} · ${esc(m.unit)}</span><code>${esc(m.code)}</code><i>Scan to enter the reading</i></div></div>`;
  }));
  return `<!doctype html><html><head><meta charset="utf-8"><title>Meter QR stickers · ${esc(property)}</title>
<style>
@page { size: A4; margin: 10mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 11px/1.3 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #2a2123; }
.bar { padding: 10px 0 14px; display: flex; gap: 12px; align-items: center; }
.bar button { font: inherit; font-size: 13px; padding: 8px 16px; border-radius: 999px; border: 0; background: #a51a2d; color: #fff; cursor: pointer; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
.s { display: flex; gap: 3mm; align-items: center; border: 0.3mm dashed #b9aaa6; border-radius: 3mm; padding: 3mm; break-inside: avoid; height: 42mm; }
.q { width: 34mm; height: 34mm; flex: none; }
.q svg { width: 100%; height: 100%; display: block; }
.t { min-width: 0; display: flex; flex-direction: column; gap: 1mm; }
.t img { height: 5mm; width: auto; align-self: flex-start; margin-bottom: 1mm; }
.t b { font-size: 12px; overflow-wrap: anywhere; }
.t span { color: #6a5f61; }
.t code { font: 600 12px ui-monospace, Consolas, monospace; color: #a51a2d; }
.t i { color: #6a5f61; font-size: 9px; }
@media print { .bar { display: none; } }
</style></head><body>
<div class="bar"><button onclick="window.print()">Print stickers</button><span>${meters.length} meter${meters.length === 1 ? '' : 's'} · cut along the dashed lines · stick next to each meter's display</span></div>
<div class="grid">${cells.join('')}</div>
</body></html>`;
}
