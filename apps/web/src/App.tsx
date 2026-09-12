import React, { Suspense } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { LandingPage } from './components/LandingPage';

// Keep the authenticated console behind a hard loading boundary. Public
// visitors do not download agent fleet management, simulation, or wallet
// code until Privy confirms an authenticated session.
const AuthenticatedConsole = React.lazy(() => import('./AuthenticatedConsole'));

const BootstrapFallback: React.FC = () => (
  <main aria-busy="true" className="min-h-screen bg-[#F3F5FA] p-6 dark:bg-[#0c1020]">
    <div className="mx-auto h-24 max-w-7xl animate-pulse rounded-[28px] bg-white/80 dark:bg-slate-800/80" />
  </main>
);

export const App: React.FC = () => {
  const { ready, authenticated } = usePrivy();

  if (!ready) return <BootstrapFallback />;
  if (!authenticated) return <LandingPage />;

  return (
    <Suspense fallback={<BootstrapFallback />}>
      <AuthenticatedConsole />
    </Suspense>
  );
};

export default App;
