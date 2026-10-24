// Sample data preview: see the dashboard with a full year of made-up figures, then remove them in one click.
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Note } from '../../components/ui.tsx';
import { notify } from '../../store/ui.ts';
import { showSampleData } from '../../store/data.ts';
import { isSampleMode } from '../../lib/sampleData.ts';

export default function SampleTab() {
  const [on, setOn] = useState(isSampleMode());
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      await showSampleData(next);
      setOn(next);
      if (next) { notify.success('Sample data shown', 'You are looking at a full year of made-up figures. Nothing was saved.'); nav('/'); }
      else notify.success('Sample data removed', 'The dashboard shows the real data again.');
    } finally { setBusy(false); }
  };
  return (
    <div className="card sample-card">
      <div className="card-head">
        <h3>Sample data preview</h3>
        <span className={on ? 'pill warn' : 'pill info'}>{on ? 'Showing sample data' : 'Showing real data'}</span>
      </div>
      <p style={{ marginTop: 0 }}>See how the dashboard looks once a whole year of readings is in: every meter, occupancy, guests, temperature, budgets, costs, guest rooms and the per-occupied-room figures, with full charts on every page. The figures follow the hotel's pattern (busier in winter, more cooling in summer) and start from each meter's own recent readings when it has some.</p>
      <ul className="sample-points">
        <li><strong>Nothing is saved.</strong> The figures are made in this browser only; your real readings are not touched.</li>
        <li><strong>Only you see it.</strong> Other users and other devices keep seeing the real data.</li>
        <li><strong>Shown for the last full reporting year,</strong> so all 12 months are filled. On a computer you can switch the year at the top right.</li>
        <li>While it is on, entering readings is switched off and every PDF says <em>SAMPLE DATA</em> in its title.</li>
      </ul>
      {on && <Note kind="warn">Sample data is shown now. Remove it before entering or checking real readings.</Note>}
      <div className="actions" style={{ marginTop: 16 }}>
        {on
          ? <button className="btn primary" disabled={busy} onClick={() => void toggle(false)}><EyeOff size={15} />{busy ? 'Removing…' : 'Remove sample data'}</button>
          : <button className="btn primary" disabled={busy} onClick={() => void toggle(true)}><Eye size={15} />{busy ? 'Preparing…' : 'Show sample data'}</button>}
      </div>
    </div>
  );
}
