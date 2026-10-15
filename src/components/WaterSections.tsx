import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { useData } from '../store/data.ts';
import { ChartCard, axisStyle, tooltipStyle } from './Chart.tsx';
import { KpiCard } from './ui.tsx';
import { fmtAuto, fmtMoney, fmtNumber } from '../lib/format.ts';
import { waterSections } from '../lib/waterSections.ts';
import type { WaterSection } from '../lib/waterSections.ts';
import { UTILITY_INFO } from '../lib/types.ts';
import { eachDay, monthShortName, parseISO } from '../lib/dates.ts';

const SECTION_COLOR: Record<string, string> = { standard: '#1f7fb8', hot_water: '#e8892d', irrigation: '#14a39b' };

/** Sections of the water total for a period (shared by the Water page, Overview and reports). */
export function useWaterSections(start: string, end: string): WaterSection[] {
  const meters = useData((s) => s.meters);
  const meterDays = useData((s) => s.meterDays);
  const tariffs = useData((s) => s.tariffs);
  return useMemo(() => waterSections(meters, meterDays, tariffs, start, end), [meters, meterDays, tariffs, start, end]);
}

export function sectionKpis(sections: WaterSection[]) {
  const unit = UTILITY_INFO.water.unit;
  return sections.map((s) => ({
    label: `${s.label} (${unit})`, value: s.total === null ? 'N/A' : fmtAuto(s.total),
  }));
}

/** KPI tiles + stacked chart for the water page. */
export function WaterSectionsPanel({ sections, start, end }: { sections: WaterSection[]; start: string; end: string }) {
  const unit = UTILITY_INFO.water.unit;
  const days = useMemo(() => eachDay(start, end), [start, end]);
  const chart = useMemo(() => days.map((d) => {
    const { m, d: day } = parseISO(d);
    const row: Record<string, string | number | null> = { label: `${day} ${monthShortName(m)}` };
    for (const s of sections) row[s.category] = s.daily.get(d)?.total ?? null;
    return row;
  }), [days, sections]);
  const none = sections.every((s) => s.meters === 0);
  return (
    <>
      <h3 style={{ margin: '18px 0 8px' }}>Water sections</h3>
      <p className="small muted" style={{ marginTop: 0 }}>Hot water and irrigation water are included in the water total above. They use the same tariff as potable water.</p>
      <div className="kpis">
        {sections.map((s) => (
          <KpiCard key={s.category} label={s.label} color={SECTION_COLOR[s.category]}
            value={s.total === null ? null : fmtAuto(s.total)} unit={unit}
            sub={s.meters === 0 ? 'No meters configured (Administration → Meters)' : `${s.share === null ? '' : `${fmtNumber(s.share, 1)} % of water · `}${s.cost.cost === null ? 'cost N/A' : fmtMoney(s.cost.cost, s.cost.currency ?? 'SAR')} · ${s.meters} meter(s)`} />
        ))}
      </div>
      {!none && (
        <ChartCard title={`Daily water by section (${unit})`} hasData={chart.some((r) => sections.some((s) => r[s.category] !== null))}>
          <BarChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#e9dfd6" /><XAxis dataKey="label" tick={axisStyle} minTickGap={24} /><YAxis tick={axisStyle} width={64} /><Tooltip contentStyle={tooltipStyle} /><Legend />
            {sections.filter((s) => s.meters > 0).map((s) => <Bar key={s.category} dataKey={s.category} name={s.label} stackId="w" fill={SECTION_COLOR[s.category]} />)}
          </BarChart>
        </ChartCard>)}
    </>
  );
}
