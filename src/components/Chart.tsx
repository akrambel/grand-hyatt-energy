import { useRef } from 'react';
import type { ReactNode } from 'react';
import { ResponsiveContainer } from 'recharts';
import { Empty } from './ui.tsx';

/** Literal hex colours (not CSS variables) so charts can be rasterised into PDFs. */
/** The one data hue is the Grand Hyatt red (sampled from the logo); neutrals are the resort's sand greys. */
export const HUE = '#a51a2d';
export const NEUTRAL = '#a8998f';
export const NEUTRAL_LIGHT = '#d9ccc1';
export const NEGATIVE = '#b4500f';
export const GRID = '#efe7df';
/** Parts of one whole: the brand red, then deeper and paler steps of it, then sand neutrals. Never a rainbow. */
export const PALETTE = ['#a51a2d', '#d16b79', '#7a1222', '#ecb3ba', '#a8998f', '#d9ccc1', '#75696b', '#efe7df'];
/** Utilities are told apart by steps of the same brand red, so stacked and paired charts stay one hue. */
export const UTILITY_COLOR = { energy: '#a51a2d', water: '#d16b79', gas: '#7a1222', chilled: '#ecb3ba' } as const;

export interface ChartSpec { title: string; series: Array<{ name: string; color: string }> }

export function ChartCard({ title, children, hasData, tall, actions, chartId }: { title: string; children: ReactNode; hasData: boolean; tall?: boolean; actions?: ReactNode; chartId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="card" data-chart-title={title} data-chart-id={chartId ?? title}>
      <div className="card-head"><h3>{title}</h3>{actions}</div>
      {hasData ? (
        <div ref={ref} className={tall ? 'chart-box tall' : 'chart-box'}>
          <ResponsiveContainer width="100%" height="100%">{children as React.ReactElement}</ResponsiveContainer>
        </div>
      ) : <Empty>No readings in the selected period.</Empty>}
    </div>
  );
}

export const axisStyle = { fontSize: 12, fill: '#6e6264' } as const;
export const tooltipStyle = { borderRadius: 6, border: '1px solid #e9dfd6', fontSize: 12 } as const;
