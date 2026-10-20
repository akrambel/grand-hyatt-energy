import { useRef } from 'react';
import type { ReactNode } from 'react';
import { ResponsiveContainer } from 'recharts';
import { Empty } from './ui.tsx';

/** Literal hex colours (not CSS variables) so charts can be rasterised into PDFs. */
/** The one data hue (Red Sea deep water) and the neutrals that sit beside it. */
export const HUE = '#1d6fa5';
export const NEUTRAL = '#9b958e';
export const NEUTRAL_LIGHT = '#cfcac3';
export const NEGATIVE = '#c4242a';
export const GRID = '#ebe8e3';
/** Parts of one whole: the data hue, then steps of the same water, then neutrals. Never a rainbow. */
export const PALETTE = ['#1d6fa5', '#5b9bc9', '#0f3f63', '#9cc3e0', '#9b958e', '#cfcac3', '#6b6560', '#e2ddd6'];
/** Utilities are told apart by depth of the same water, so stacked and paired charts stay one hue. */
export const UTILITY_COLOR = { energy: '#1d6fa5', water: '#5b9bc9', gas: '#0f3f63', chilled: '#9cc3e0' } as const;

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

export const axisStyle = { fontSize: 12, fill: '#5d5853' } as const;
export const tooltipStyle = { borderRadius: 6, border: '1px solid #e6e2dc', fontSize: 12 } as const;
