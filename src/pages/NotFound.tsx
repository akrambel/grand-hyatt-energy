import { Link } from 'react-router-dom';
import { PageHead } from '../components/ui.tsx';
export default function NotFound() {
  return (<><PageHead title="Page not found" subtitle="This page does not exist." /><Link className="btn primary" to="/">Back to Overview</Link></>);
}
