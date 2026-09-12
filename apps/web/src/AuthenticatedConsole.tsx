import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MarketplaceProvider, useMarketplace } from './context/MarketplaceContext';
import { ToastProvider } from './context/ToastContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { SkeletonCard } from './components/common/UiState';
import { FintechHeader } from './components/fintech/FintechHeader';
import { WorkspaceSidebar } from './components/fintech/WorkspaceSidebar';

const BuyerPortal = React.lazy(() =>
  import('./components/buyer/BuyerPortal').then((module) => ({ default: module.BuyerPortal }))
);
const SellerPortal = React.lazy(() =>
  import('./components/seller/SellerPortal').then((module) => ({ default: module.SellerPortal }))
);

const PortalLoadingFallback: React.FC = () => (
  <div aria-busy="true" className="space-y-6 animate-pulse py-4 font-sans">
    <div className="h-24 rounded-[28px] border border-slate-200/80 bg-white dark:border-slate-700 dark:bg-slate-800" />
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  </div>
);

const MainLayout: React.FC = () => {
  const { isAuthenticated, userRole } = useMarketplace();
  const roleHome = userRole === 'buyer' ? '/buyer/overview' : '/operator/overview';

  if (!isAuthenticated) return null;

  return (
    <div className="flex min-h-screen flex-col justify-between bg-[#F3F5FA] font-sans text-slate-900 selection:bg-[#254BFF] selection:text-white dark:bg-[#0c1020] dark:text-slate-100">
      <a
        href="#portal-main-content"
        className="sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:not-sr-only rounded-xl bg-[#254BFF] px-4 py-2 font-bold text-white shadow-lg focus:outline-none"
      >
        Skip to main content
      </a>

      <ErrorBoundary fallbackTitle="Navigation Bar Alert">
        <FintechHeader />
      </ErrorBoundary>

      <div className="mx-auto flex w-full max-w-[1600px] flex-1">
        <WorkspaceSidebar />
        <main id="portal-main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-4 focus:outline-none sm:px-6 lg:px-8">
          <Suspense fallback={<PortalLoadingFallback />}>
            <Routes>
              <Route path="/" element={<Navigate to={roleHome} replace />} />
              <Route
                path="/buyer/*"
                element={userRole === 'buyer' ? <ErrorBoundary fallbackTitle="Buyer Console Alert"><BuyerPortal /></ErrorBoundary> : <Navigate to="/operator/overview" replace />}
              />
              <Route
                path="/operator/*"
                element={userRole === 'seller' ? <ErrorBoundary fallbackTitle="Operator Console Alert"><SellerPortal /></ErrorBoundary> : <Navigate to="/buyer/overview" replace />}
              />
              <Route path="*" element={<Navigate to={roleHome} replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>

      <footer className="mt-8 border-t border-slate-200/80 bg-white/60 py-4 text-xs text-slate-500 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
        <div className="mx-auto flex max-w-[1400px] flex-col items-center justify-between gap-3 px-4 sm:flex-row sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-slate-700 dark:text-slate-200">ComputeX</span>
            <span>•</span>
            <span>Enterprise compute capacity marketplace</span>
            <span>•</span>
            <span className="font-medium text-[#254BFF] dark:text-blue-400">Marketplace network</span>
          </div>
          <div className="flex items-center space-x-4 text-[11px] font-medium">
            <span className="flex items-center space-x-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /><span>Network confirmation target</span></span>
            <span>•</span><span>SLA policy target</span><span>•</span><span>Protected delivery and payment</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export const AuthenticatedConsole: React.FC = () => (
  <MarketplaceProvider>
    <ToastProvider>
      <BrowserRouter>
        <MainLayout />
      </BrowserRouter>
    </ToastProvider>
  </MarketplaceProvider>
);

export default AuthenticatedConsole;
