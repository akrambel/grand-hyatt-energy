// Professional PDF reports with jsPDF + autotable: logo, title, period, filters, KPIs, charts, tables, footer.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { logoUrl } from '../config/env.ts';
import { downloadBlob, NA } from './format.ts';
import type { CapturedChart } from './chartImage.ts';
import { isSampleMode } from './sampleData.ts';

export interface PdfKpi { label: string; value: string }
export interface PdfTable { title: string; headers: string[]; rows: Array<Array<string | number | null>>; numericCols?: number[] }
export interface PdfReport {
  title: string;
  period: string;
  filters?: Array<[string, string]>;
  kpis?: PdfKpi[];
  charts?: CapturedChart[];
  tables?: PdfTable[];
  notes?: string[];
  user: string;
  property: string;
  timezone: string;
  filename: string;
  landscape?: boolean;
  /** true: only return the file (for saving it in the website) instead of downloading it. */
  noDownload?: boolean;
}

const TEAL: [number, number, number] = [165, 26, 45]; // Grand Hyatt red
const CREAM: [number, number, number] = [255, 255, 255];
const BURG: [number, number, number] = [232, 137, 45]; // coral accent

async function loadLogo(): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const res = await fetch(logoUrl());
    if (!res.ok) return null;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('logo')); img.src = url; });
      const w = img.naturalWidth || 240, h = img.naturalHeight || 64;
      const canvas = document.createElement('canvas');
      const k = Math.min(2, 640 / w); // sharp at print size without making the PDF heavy
      canvas.width = Math.round(w * k); canvas.height = Math.round(h * k); // keeps aspect ratio, rasterises SVG too
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return { data: canvas.toDataURL('image/png'), w, h };
    } finally { URL.revokeObjectURL(url); }
  } catch { return null; }
}

export async function buildPdf(report: PdfReport): Promise<Blob> {
  // made-up figures of the sample preview are labelled on every page
  const r = isSampleMode() ? { ...report, title: `SAMPLE DATA – ${report.title}` } : report;
  const doc = new jsPDF({ orientation: r.landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const logo = await loadLogo();
  const generated = new Intl.DateTimeFormat('en-GB', { timeZone: r.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date());

  // header: white band with the property logo (kept in proportion), brand-red rule underneath
  if (logo) {
    const h = 17, w = Math.min(70, (logo.w / logo.h) * h);
    doc.addImage(logo.data, 'PNG', M, 5, w, w * (logo.h / logo.w), 'logo', 'FAST');
  } else {
    doc.setTextColor(...TEAL); doc.setFont('times', 'bold'); doc.setFontSize(15); doc.text(r.property, M, 14);
  }
  doc.setTextColor(117, 105, 107); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Energy, Utilities & Environmental Monitoring', W - M, 13, { align: 'right' });
  doc.setFillColor(...TEAL); doc.rect(0, 25, W, 1.6, 'F');
  doc.setFillColor(...BURG); doc.rect(0, 26.6, W, 0.7, 'F');

  let y = 36;
  doc.setTextColor(30, 40, 40); doc.setFont('times', 'bold'); doc.setFontSize(18);
  doc.text(r.title, M, y); y += 7;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90, 100, 100);
  doc.text(r.period, M, y); y += 5;
  if (r.filters?.length) {
    const line = r.filters.map(([k, v]) => `${k}: ${v}`).join('   |   ');
    const lines = doc.splitTextToSize(`Filters – ${line}`, W - 2 * M) as string[];
    doc.text(lines, M, y); y += lines.length * 4.2;
  }
  y += 3;

  const ensure = (need: number) => { if (y + need > H - 16) { doc.addPage(); y = 18; } };

  if (r.kpis?.length) {
    const cols = r.landscape ? 4 : 3;
    const bw = (W - 2 * M - (cols - 1) * 3) / cols, bh = 17;
    r.kpis.forEach((k, i) => {
      if (i % cols === 0) ensure(bh + 3);
      const x = M + (i % cols) * (bw + 3);
      doc.setFillColor(250, 247, 238); doc.setDrawColor(227, 221, 201); doc.roundedRect(x, y, bw, bh, 2, 2, 'FD');
      doc.setFillColor(...TEAL); doc.rect(x, y, 1.2, bh, 'F');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(98, 115, 111);
      doc.text(k.label.toUpperCase(), x + 4, y + 5.5, { maxWidth: bw - 6 });
      doc.setFont('times', 'bold'); doc.setFontSize(k.value === NA ? 10 : 13); doc.setTextColor(2, 60, 57);
      doc.text(k.value === NA ? 'No data available' : k.value, x + 4, y + 13, { maxWidth: bw - 6 });
      if (i % cols === cols - 1 || i === r.kpis!.length - 1) y += bh + 3;
    });
    y += 2;
  }

  for (const c of r.charts ?? []) {
    const w = W - 2 * M, h = Math.min(85, w * (c.height / c.width));
    ensure(h + 10);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(2, 60, 57);
    doc.text(c.title, M, y); y += 2;
    doc.addImage(c.dataUrl, 'PNG', M, y, w, h); y += h + 6;
  }

  for (const t of r.tables ?? []) {
    ensure(24);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(2, 60, 57);
    doc.text(t.title, M, y); y += 2;
    autoTable(doc, {
      startY: y, margin: { left: M, right: M, bottom: 16 },
      head: [t.headers], body: t.rows.length ? t.rows.map((row) => row.map((c) => (c === null || c === undefined || c === '' ? NA : String(c)))) : [[{ content: 'No data available', colSpan: t.headers.length, styles: { halign: 'center', textColor: [117, 105, 107] } } as never]],
      styles: { fontSize: 7.5, cellPadding: 1.6, lineColor: [233, 223, 214], lineWidth: 0.1 },
      headStyles: { fillColor: TEAL, textColor: CREAM, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [250, 246, 242] },
      columnStyles: Object.fromEntries((t.numericCols ?? []).map((i) => [i, { halign: 'right' }])),
      showHead: 'everyPage',
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  if (r.notes?.length) {
    ensure(8 + r.notes.length * 5);
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(98, 115, 111);
    for (const n of r.notes) { const ls = doc.splitTextToSize(`• ${n}`, W - 2 * M) as string[]; doc.text(ls, M, y); y += ls.length * 3.6 + 1; }
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(227, 221, 201); doc.line(M, H - 12, W - M, H - 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(98, 115, 111);
    doc.text(`${r.property} – ${r.title}`, M, H - 7.5);
    doc.text(`Generated ${generated} (${r.timezone}) by ${r.user}`, W / 2, H - 7.5, { align: 'center' });
    doc.text(`Page ${p} of ${pages}`, W - M, H - 7.5, { align: 'right' });
    doc.setFontSize(6.5); doc.text('Confidential – for internal engineering and management use.', M, H - 4);
  }
  const blob = doc.output('blob');
  if (!r.noDownload) downloadBlob(blob, r.filename);
  return blob;
}
