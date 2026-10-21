import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { clsx, NA } from '../lib/format.ts';

export interface Column<T> {
  key: string;
  header: string;
  /** Raw value used for sorting, searching and exports. */
  value: (row: T) => string | number | null | undefined;
  /** Display override. */
  render?: (row: T) => ReactNode;
  num?: boolean;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T, i: number) => string;
  pageSizes?: number[];
  defaultPageSize?: number;
  searchable?: boolean;
  /** Return true to highlight the row as flagged. */
  rowClass?: (row: T) => boolean;
  empty?: ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  /** Called whenever the filtered+sorted rows change – used by export buttons. */
  onView?: (rows: T[]) => void;
}

const cmp = (a: unknown, b: unknown): number => {
  const an = a === null || a === undefined || a === '';
  const bn = b === null || b === undefined || b === '';
  if (an && bn) return 0;
  if (an) return 1; // blanks last
  if (bn) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
};

export function DataTable<T>({ rows, columns, rowKey, pageSizes = [10, 25, 50, 100], defaultPageSize = 25, searchable = true, rowClass, empty, initialSort, onView }: Props<T>) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort ?? null);
  const [size, setSize] = useState(defaultPageSize);
  const [page, setPage] = useState(0);

  // Column definitions are usually created inline on every render; keep the latest in a ref so they do not retrigger the memo.
  const props_columns = columns;
  const colsRef = useRef<typeof props_columns>(columns);
  colsRef.current = columns;

  const view = useMemo(() => {
    const columns = colsRef.current as typeof props_columns;
    const needle = q.trim().toLowerCase();
    let r = rows;
    if (needle) r = r.filter((row) => columns.some((c) => String(c.value(row) ?? '').toLowerCase().includes(needle)));
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) { const f = sort.dir === 'asc' ? 1 : -1; r = [...r].sort((a, b) => f * cmp(col.value(a), col.value(b))); }
    }
    return r;
  }, [rows, q, sort]);

  useEffect(() => { onView?.(view); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const pages = Math.max(1, Math.ceil(view.length / size));
  const cur = Math.min(page, pages - 1);
  const slice = view.slice(cur * size, cur * size + size);

  return (
    <div>
      <div className="table-bar">
        {searchable ? (
          <div className="search" style={{ width: 260 }}>
            <Search size={16} />
            <input aria-label="Search table" placeholder="Search table…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          </div>
        ) : <span />}
        <span className="small muted">{view.length} row{view.length === 1 ? '' : 's'}{view.length !== rows.length && ` (of ${rows.length})`}</span>
      </div>
      <div className="table-wrap">
        <table className="data stack">
          <thead><tr>
            {columns.map((c) => (
              <th key={c.key} className={clsx(c.num && 'num')} onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }))}
                aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                {c.header}{sort?.key === c.key && (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
              </th>))}
          </tr></thead>
          <tbody>
            {slice.map((row, i) => (
              <tr key={rowKey(row, i)} className={rowClass?.(row) ? 'flag' : undefined}>
                {columns.map((c) => {
                  const v = c.value(row);
                  return <td key={c.key} className={clsx(c.num && 'num')} data-label={c.header}>{c.render ? c.render(row) : (v === null || v === undefined || v === '' ? <span className="muted">{NA}</span> : String(v))}</td>;
                })}
              </tr>))}
            {slice.length === 0 && <tr className="empty"><td colSpan={columns.length} style={{ textAlign: 'center', padding: 24 }} className="muted">{empty ?? 'No data available'}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="table-bar">
        <label className="small muted">Rows per page{' '}
          <select className="input" style={{ width: 'auto', padding: '2px 6px' }} value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>
            {pageSizes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="pager">
          <button className="btn sm" disabled={cur === 0} onClick={() => setPage(cur - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button>
          <span className="small">Page {cur + 1} / {pages}</span>
          <button className="btn sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} aria-label="Next page"><ChevronRight size={14} /></button>
        </div>
      </div>
    </div>
  );
}

