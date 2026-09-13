import React, { Suspense } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { LandingPage } from './components/LandingPage';

// Keep the authenticated console behind a hard loading boundary. Public
// visitors do not download agent fleet management, simulation, or wallet
// code until Privy confirms an authenticated session.
const AuthenticatedConsole = React.lazy(() => import('./AuthenticatedConsole'));

import { ConsoleSkeleton } from './components/common/ConsoleSkeleton';

export const App: React.FC = () => {
  const { ready, authenticated } = usePrivy();

  if (!ready) return <ConsoleSkeleton isFullApp />;
  if (!authenticated) return <LandingPage />;

  return (
    <Suspense fallback={<ConsoleSkeleton isFullApp />}>
      <AuthenticatedConsole />
    </Suspense>
  );
};

export default App;
