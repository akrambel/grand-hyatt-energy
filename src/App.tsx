import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, useIsAdmin } from './store/auth.ts';
import { Layout } from './components/Layout.tsx';
import { Loading } from './components/ui.tsx';
import Login from './pages/Login.tsx';

const Overview = lazy(() => import('./pages/Overview.tsx'));
const DailyEntry = lazy(() => import('./pages/DailyEntry.tsx'));
const DailyConsumption = lazy(() => import('./pages/DailyConsumption.tsx'));
const UtilityPage = lazy(() => import('./pages/UtilityPage.tsx'));
const Costs = lazy(() => import('./pages/Costs.tsx'));
const Budget = lazy(() => import('./pages/Budget.tsx'));
const Lpg = lazy(() => import('./pages/Lpg.tsx'));
const Compare = lazy(() => import('./pages/Compare.tsx'));
const Climate = lazy(() => import('./pages/Climate.tsx'));
const Live = lazy(() => import('./pages/Live.tsx'));
const Monthly = lazy(() => import('./pages/Monthly.tsx'));
const Annual = lazy(() => import('./pages/Annual.tsx'));
const Alerts = lazy(() => import('./pages/Alerts.tsx'));
const Admin = lazy(() => import('./pages/Admin.tsx'));
const Profile = lazy(() => import('./pages/Profile.tsx'));
const NotFound = lazy(() => import('./pages/NotFound.tsx'));

function AdminOnly({ children }: { children: JSX.Element }) {
  return useIsAdmin() ? children : <Navigate to="/" replace />;
}

export default function App() {
  const { status, init } = useAuth();
  useEffect(() => { void init(); }, [init]);

  if (status === 'loading') return <div style={{ padding: 40 }}><Loading /></div>;
  if (status === 'signedOut') return <Login />;

  return (
    <HashRouter>
      <Suspense fallback={<div style={{ padding: 40 }}><Loading /></div>}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Overview />} />
            <Route path="entry" element={<DailyEntry />} />
            <Route path="daily" element={<DailyConsumption />} />
            <Route path="energy" element={<UtilityPage utility="energy" />} />
            <Route path="water" element={<UtilityPage utility="water" />} />
            <Route path="gas" element={<UtilityPage utility="gas" />} />
            <Route path="chilled" element={<UtilityPage utility="chilled" />} />
            <Route path="lpg" element={<Lpg />} />
            <Route path="costs" element={<Costs />} />
            <Route path="budget" element={<Budget />} />
            <Route path="compare" element={<Compare />} />
            <Route path="climate" element={<Climate />} />
            <Route path="live" element={<Live />} />
            <Route path="monthly" element={<Monthly />} />
            <Route path="annual" element={<Annual />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="admin" element={<AdminOnly><Admin /></AdminOnly>} />
            <Route path="profile" element={<Profile />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
