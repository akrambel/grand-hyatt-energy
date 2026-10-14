import { useRef } from 'react';
import type { ReactNode } from 'react';
import { ResponsiveContainer } from 'recharts';
import { Empty } from './ui.tsx';

/** Literal hex colours (not CSS variables) so charts can be rasterised into PDFs. */
export const PALETTE = ['#a51a2d', '#14a39b', '#e8892d', '#1f7fb8', '#c94f7c', '#d9a038', '#6b4e9b', '#7a6a66'];
export const UTILITY_COLOR = { energy: '#e8892d', water: '#1f7fb8', gas: '#a51a2d', chilled: '#14a39b' } as const;

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
      ) : <Empty>No data available for the selected period.</Empty>}
    </div>
  );
}

export const axisStyle = { fontSize: 11, fill: '#75696b' } as const;
export const tooltipStyle = { borderRadius: 10, border: '1px solid #e9dfd6', fontSize: 12 } as const;
