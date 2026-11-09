import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useSession } from './lib/session';
import { AppShell } from './layout/AppShell';
import { Spinner } from './components/ui';
import { AuthPage } from './pages/AuthPage';

const Onboarding = lazy(() => import('./pages/Onboarding'));
const Overview = lazy(() => import('./pages/Overview'));
const Decisions = lazy(() => import('./pages/Decisions'));
const NewDecision = lazy(() => import('./pages/NewDecision'));
const Workspace = lazy(() => import('./pages/workspace/Workspace'));
const Journal = lazy(() => import('./pages/Journal'));
const Report = lazy(() => import('./pages/Report'));
const Settings = lazy(() => import('./pages/settings/Settings'));
const NotFound = lazy(() => import('./pages/NotFound'));

function FullPageSpinner() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
      <Spinner />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const loc = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anonymous') return <Navigate to="/signin" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const loc = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated') {
    const from = (loc.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/signin' ? from : '/'} replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/signin" element={<PublicOnly><AuthPage mode="signin" /></PublicOnly>} />
        <Route path="/register" element={<PublicOnly><AuthPage mode="register" /></PublicOnly>} />
        <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
        <Route path="/reports/:id" element={<RequireAuth><Report /></RequireAuth>} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<Overview />} />
          <Route path="decisions" element={<Decisions />} />
          <Route path="decisions/new" element={<NewDecision />} />
          <Route path="decisions/:id" element={<Workspace />} />
          <Route path="journal" element={<Journal />} />
          <Route path="settings" element={<Navigate to="/settings/profile" replace />} />
          <Route path="settings/:section" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
