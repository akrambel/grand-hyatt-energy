// Excel exports: (1) full workbook in the original layout, (2) any filtered table as a clean sheet.
import ExcelJS from 'exceljs';
import { logoUrl, templateUrl } from '../config/env.ts';
import { applyWrites, loadWorkbook, readerFor } from './excelAdapter.ts';
import { planExport } from './workbook.ts';
import type { ExportData } from './workbook.ts';
import { downloadBlob } from './format.ts';

export async function exportWorkbookFromTemplate(data: ExportData, filename: string, templateBuffer?: ArrayBuffer): Promise<{ warnings: string[]; applied: number }> {
  let buf = templateBuffer;
  if (!buf) {
    const res = await fetch(templateUrl());
    if (!res.ok) throw new Error('The Excel template could not be loaded.');
    buf = await res.arrayBuffer();
  }
  const wb = await loadWorkbook(buf);
  const plan = planExport(readerFor(wb), data);
  const { applied, skippedFormula } = applyWrites(wb, plan.writes);
  if (skippedFormula) plan.warnings.push(`${skippedFormula} cell(s) contain formulas and were left unchanged.`);
  // Excel recalculates formulas when the file is opened.
  wb.calcProperties = { fullCalcOnLoad: true } as ExcelJS.CalculationProperties;
  const out = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  return { warnings: plan.warnings, applied };
}

export interface SheetSpec {
  name: string;
  title?: string;
  subtitle?: string[];
  headers: string[];
  rows: Array<Array<string | number | null>>;
  numFmt?: Record<number, string>;
}

export interface ExportMeta {
  property?: string;
  user?: string;
  /** Already formatted in the property's local time zone. */
  generated?: string;
}

const RED = 'FFA51A2D', CORAL = 'FFE8892D', SAND = 'FFFAF6F2', LINE = 'FFE9DFD6', GREY = 'FF75696B', INK = 'FF2B2224';
const thin = (argb: string) => ({ style: 'thin' as const, color: { argb } });

function toBase64(buf: ArrayBuffer): string {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Loads the property logo for the report header; returns null (report is still produced) when it cannot be loaded. */
async function loadLogoBase64(): Promise<string | null> {
  try {
    const res = await fetch(logoUrl());
    if (!res.ok) return null;
    return toBase64(await res.arrayBuffer());
  } catch { return null; }
}

/** Exports one or more tables as formatted report sheets (exactly the data the user is looking at). */
export async function exportTables(sheets: SheetSpec[], filename: string, meta: ExportMeta = {}): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = `${meta.property ?? 'Grand Hyatt The Red Sea'} – Energy Dashboard`;
  wb.created = new Date();
  const logo = await loadLogoBase64();
  const logoId = logo ? wb.addImage({ base64: logo, extension: 'png' }) : null;

  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31), { properties: { tabColor: { argb: RED } } });
    const n = Math.max(1, s.headers.length);
    let r = 1;
    const mergeRow = (row: number): void => { if (n > 1) ws.mergeCells(row, 1, row, n); }; // a 1-cell merge would corrupt the file

    // logo block (3 rows)
    if (logoId !== null) {
      for (let i = 1; i <= 3; i++) ws.getRow(i).height = 20;
      ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 170, height: 54 } });
      r = 4;
    }
    // title block
    if (s.title) {
      mergeRow(r);
      const c = ws.getCell(r, 1);
      c.value = s.title; c.font = { bold: true, size: 16, color: { argb: RED } };
      c.alignment = { vertical: 'middle' }; ws.getRow(r).height = 26; r++;
    }
    for (const line of s.subtitle ?? []) {
      mergeRow(r);
      const c = ws.getCell(r, 1);
      c.value = line; c.font = { italic: true, size: 10, color: { argb: GREY } }; r++;
    }
    if (s.title || s.subtitle?.length) {
      for (let col = 1; col <= n; col++) ws.getCell(r - 1, col).border = { bottom: { style: 'medium', color: { argb: CORAL } } };
      r++;
    }

    // table header
    const headerRow = r;
    ws.getRow(headerRow).height = 30;
    s.headers.forEach((h, i) => {
      const c = ws.getCell(headerRow, i + 1);
      c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
      c.border = { top: thin(RED), bottom: thin(RED), left: thin('FFFFFFFF'), right: thin('FFFFFFFF') };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });

    // numeric columns: right-aligned with a thousands separator
    const numeric = s.headers.map((_, i) => {
      const vals = s.rows.map((row) => row[i]).filter((v) => v !== null && v !== undefined && v !== '');
      return vals.length > 0 && vals.every((v) => typeof v === 'number');
    });
    const fmtFor = (i: number): string | undefined => {
      if (s.numFmt?.[i]) return s.numFmt[i];
      if (!numeric[i]) return undefined;
      return s.rows.every((row) => typeof row[i] !== 'number' || Number.isInteger(row[i] as number)) ? '#,##0' : '#,##0.00';
    };

    // body
    s.rows.forEach((row, ri) => {
      const rr = headerRow + 1 + ri;
      row.forEach((v, ci) => {
        const c = ws.getCell(rr, ci + 1);
        c.value = v;
        c.font = { size: 10, color: { argb: INK } };
        c.border = { top: thin(LINE), bottom: thin(LINE), left: thin(LINE), right: thin(LINE) };
        if (ri % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SAND } };
        if (numeric[ci]) { c.alignment = { horizontal: 'right' }; const f = fmtFor(ci); if (f && typeof v === 'number') c.numFmt = f; }
      });
    });
    if (!s.rows.length) {
      mergeRow(headerRow + 1);
      const c = ws.getCell(headerRow + 1, 1);
      c.value = 'No data available for the selected filters.'; c.font = { italic: true, color: { argb: GREY } }; c.alignment = { horizontal: 'center' };
    }

    // footer note
    let fr = headerRow + Math.max(1, s.rows.length) + 2;
    const parts = [meta.property, meta.generated ? `Generated ${meta.generated}` : null, meta.user ? `by ${meta.user}` : null].filter(Boolean);
    if (parts.length) { mergeRow(fr); const c = ws.getCell(fr, 1); c.value = parts.join('  ·  '); c.font = { italic: true, size: 9, color: { argb: GREY } }; fr++; }

    // columns, freeze, filter, print setup
    s.headers.forEach((h, i) => {
      const longest = Math.max(h.length, ...s.rows.slice(0, 500).map((row) => String(row[i] ?? '').length));
      ws.getColumn(i + 1).width = Math.min(48, Math.max(11, longest + 3));
    });
    ws.views = [{ state: 'frozen', ySplit: headerRow, showGridLines: false }];
    if (s.rows.length) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: n } };
    ws.pageSetup = { orientation: n > 6 ? 'landscape' : 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${headerRow}:${headerRow}` };
    ws.headerFooter = { oddFooter: `&L${(meta.property ?? '').replace(/&/g, '&&')}&CPage &P of &N&R&D` };
  }
  const out = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}
