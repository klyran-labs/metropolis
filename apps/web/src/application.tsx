import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { useIdentity } from "./identity";
import { Navigation, type View } from "./navigation";
import { configuration } from "./configuration";
import {
  Billing,
  Fleet,
  Overview,
  Platform,
  Policy,
  Settings,
} from "./screens";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: false },
  },
});

function Shell() {
  const identity = useIdentity();
  const [view, setView] = useState<View>("overview");
  if (!identity.authenticated) return <Landing />;
  const content =
    view === "fleet" ? (
      <Fleet />
    ) : view === "policy" ? (
      <Policy />
    ) : view === "billing" ? (
      <Billing />
    ) : view === "settings" ? (
      <Settings />
    ) : view === "platform" && identity.platformAccess ? (
      <Platform />
    ) : (
      <Overview />
    );
  return (
    <div className="app-shell">
      <Navigation
        view={view}
        onView={setView}
        platformAccess={identity.platformAccess}
        onLogout={() => void identity.logout()}
      />
      <main className="content">
        <div className="mobile-bar">
          <strong>{configuration.brand}</strong>
        </div>
        {content}
      </main>
    </div>
  );
}
function Landing() {
  const identity = useIdentity();
  return (
    <main className="landing">
      <div className="landing-card">
        <span className="brand-mark">A</span>
        <span className="eyebrow">
          {identity.ready ? "Secure control plane" : "Preparing workspace"}
        </span>
        <h1>Govern autonomous spend with clear authority.</h1>
        <p>
          Tenant-isolated policy, verified settlement, and chain-derived
          evidence for agent operations.
        </p>
        <button
          type="button"
          className="control control-filled"
          onClick={() => void identity.login()}
        >
          Sign in
        </button>
      </div>
    </main>
  );
}

export default function Application() {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}
