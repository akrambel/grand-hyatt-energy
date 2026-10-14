import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { stripTableContentTypes, stripTableParts, stripTableRels } from '../src/lib/xlsxSanitize.ts';

const XLSX = 'public/templates/Main_Consumption_Opening_Closing.xlsx';
const part = (p: string): string => execFileSync('unzip', ['-p', XLSX, p], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

test('table parts are removed from the sheet that has the table, data is untouched', () => {
  const sheet = part('xl/worksheets/sheet5.xml');
  assert.match(sheet, /<tableParts/);
  const out = stripTableParts(sheet);
  assert.doesNotMatch(out, /tableParts/);
  assert.equal(out.length, sheet.length - sheet.match(/<tableParts[\s\S]*?<\/tableParts>/)![0].length);
  assert.equal((out.match(/<c /g) ?? []).length, (sheet.match(/<c /g) ?? []).length); // same number of cells
});

test('only the table relationship is removed, hyperlinks stay', () => {
  const rels = part('xl/worksheets/_rels/sheet5.xml.rels');
  const before = (rels.match(/<Relationship /g) ?? []).length;
  const out = stripTableRels(rels);
  assert.equal((out.match(/<Relationship /g) ?? []).length, before - 1);
  assert.doesNotMatch(out, /tables\//);
  assert.match(out, /hyperlink/);
});

test('content types lose the table override only', () => {
  const ct = part('\\[Content_Types\\].xml');
  assert.match(ct, /\/xl\/tables\/table1\.xml/);
  const out = stripTableContentTypes(ct);
  assert.doesNotMatch(out, /xl\/tables/);
  assert.match(out, /worksheets\/sheet1\.xml/);
});

test('sheets without tables are unchanged', () => {
  const s = part('xl/worksheets/sheet2.xml').slice(0, 200000);
  assert.equal(stripTableParts(s), s);
});
