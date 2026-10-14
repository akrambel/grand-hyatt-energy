// Rasterises Recharts SVG charts (found by data-chart-title) into PNG data URLs for the PDF reports.
export interface CapturedChart { title: string; dataUrl: string; width: number; height: number }

async function svgToPng(svg: SVGSVGElement, legend: Array<{ text: string; color: string }>, scale = 2): Promise<CapturedChart['dataUrl'] | null> {
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(rect.width));
  clone.setAttribute('height', String(rect.height));
  clone.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
  clone.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
  const text = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('chart image failed')); img.src = url; });
    const canvas = document.createElement('canvas');
    const legendH = legend.length ? 26 : 0;
    canvas.width = rect.width * scale; canvas.height = (rect.height + legendH) * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, rect.width * scale, rect.height * scale);
    // Recharts draws its legend as HTML next to the SVG, so it is redrawn here from the DOM.
    if (legend.length) {
      ctx.font = `${12 * scale}px Arial, sans-serif`;
      ctx.textBaseline = 'middle';
      let x = 16 * scale;
      const y = (rect.height + legendH / 2) * scale;
      for (const item of legend) {
        ctx.fillStyle = item.color; ctx.fillRect(x, y - 5 * scale, 12 * scale, 10 * scale);
        x += 18 * scale;
        ctx.fillStyle = '#2b2224'; ctx.fillText(item.text, x, y);
        x += ctx.measureText(item.text).width + 18 * scale;
      }
    }
    return canvas.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}

/** Captures every chart currently shown on the page. Charts with no data are skipped. */
export async function captureCharts(root: ParentNode = document): Promise<CapturedChart[]> {
  const out: CapturedChart[] = [];
  for (const card of Array.from(root.querySelectorAll<HTMLElement>('[data-chart-title]'))) {
    const svg = card.querySelector<SVGSVGElement>('svg.recharts-surface');
    if (!svg) continue;
    try {
      const legend = Array.from(card.querySelectorAll<HTMLElement>('.recharts-legend-item')).map((li) => {
        const icon = li.querySelector('path, line, rect');
        const color = icon?.getAttribute('fill') && icon.getAttribute('fill') !== 'none' ? icon.getAttribute('fill') : icon?.getAttribute('stroke');
        return { text: li.textContent?.trim() ?? '', color: color ?? '#a51a2d' };
      }).filter((l) => l.text);
      const dataUrl = await svgToPng(svg, legend);
      if (dataUrl) { const r = svg.getBoundingClientRect(); out.push({ title: card.dataset.chartTitle ?? 'Chart', dataUrl, width: r.width, height: r.height + (legend.length ? 26 : 0) }); }
    } catch { /* skip charts that cannot be rendered */ }
  }
  return out;
}
