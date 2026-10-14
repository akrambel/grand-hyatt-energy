// ExcelJS <-> CellReader bridge. Kept apart from workbook.ts so the pure logic stays testable without ExcelJS.
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { isTablePart, stripTableContentTypes, stripTableParts, stripTableRels } from './xlsxSanitize.ts';
import type { CellReader, CellValue, CellWrite } from './workbook.ts';

function plain(v: ExcelJS.CellValue): CellValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if ('result' in o) return plain(o.result as ExcelJS.CellValue); // formula -> cached result
    if ('richText' in o && Array.isArray(o.richText)) return (o.richText as Array<{ text: string }>).map((t) => t.text).join('');
    if ('text' in o && typeof o.text === 'string') return o.text; // hyperlink
    if ('error' in o) return null;
  }
  return null;
}

export function readerFor(wb: ExcelJS.Workbook): CellReader {
  return {
    sheetNames: () => wb.worksheets.filter(Boolean).map((w: { name: string }) => w.name),
    get: (sheet, row, col) => {
      const ws = wb.getWorksheet(sheet);
      return ws ? plain(ws.getCell(row, col).value) : null;
    },
    maxRow: (sheet) => wb.getWorksheet(sheet)?.rowCount ?? 0,
    maxCol: (sheet) => wb.getWorksheet(sheet)?.columnCount ?? 0,
  };
}

/** Rebuilds the package without Excel table objects (they hold no data the app needs). */
async function withoutTables(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buffer);
  for (const path of Object.keys(zip.files)) {
    const file = zip.file(path);
    if (!file) continue;
    if (isTablePart(path)) { zip.remove(path); continue; }
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) zip.file(path, stripTableParts(await file.async('string')));
    else if (/^xl\/worksheets\/_rels\/.+\.rels$/.test(path)) zip.file(path, stripTableRels(await file.async('string')));
    else if (path === '[Content_Types].xml') zip.file(path, stripTableContentTypes(await file.async('string')));
  }
  return zip.generateAsync({ type: 'arraybuffer' });
}

export async function loadWorkbook(buffer: ArrayBuffer): Promise<ExcelJS.Workbook> {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    return wb;
  } catch (first) {
    // Retry once without table objects; if that also fails, report the ORIGINAL problem.
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await withoutTables(buffer));
      return wb;
    } catch {
      throw first;
    }
  }
}

/** Writes values into the template. Existing formulas are never overwritten (writes onto formula cells are skipped). */
export function applyWrites(wb: ExcelJS.Workbook, writes: CellWrite[]): { applied: number; skippedFormula: number } {
  let applied = 0, skippedFormula = 0;
  for (const w of writes) {
    const ws = wb.getWorksheet(w.sheet);
    if (!ws) continue;
    const cell = ws.getCell(w.row, w.col);
    const v = cell.value as unknown;
    if (v && typeof v === 'object' && ('formula' in (v as object) || 'sharedFormula' in (v as object))) { skippedFormula++; continue; }
    cell.value = w.value;
    applied++;
  }
  return { applied, skippedFormula };
}
