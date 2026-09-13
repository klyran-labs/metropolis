import React, { Suspense } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { LandingPage } from './components/LandingPage';

// Keep the authenticated console behind a hard loading boundary. Public
// visitors do not download agent fleet management, simulation, or wallet
// code until Privy confirms an authenticated session.
const AuthenticatedConsole = React.lazy(() => import('./AuthenticatedConsole'));

const BootstrapFallback: React.FC = () => (
  <main aria-busy="true" className="min-h-screen bg-app p-6">
    <div className="mx-auto h-24 max-w-7xl animate-pulse rounded-[28px] bg-card/80 border border-card-border" />
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
