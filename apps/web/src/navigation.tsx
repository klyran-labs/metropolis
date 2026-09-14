import {
  Activity,
  CreditCard,
  LayoutDashboard,
  ListTree,
  Settings2,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { configuration, networkLabel } from "./configuration";
import { Button } from "./design-system";

export type View =
  "overview" | "fleet" | "policy" | "billing" | "settings" | "platform";
const tenantItems: Array<[View, string, ReactNode]> = [
  ["overview", "Overview", <LayoutDashboard size={17} />],
  ["fleet", "Fleet", <ListTree size={17} />],
  ["policy", "Policy", <ShieldCheck size={17} />],
  ["billing", "Subscription", <CreditCard size={17} />],
  ["settings", "Settings", <Settings2 size={17} />],
];

export function Navigation({
  view,
  onView,
  platformAccess,
  onLogout,
}: {
  view: View;
  onView: (view: View) => void;
  platformAccess: boolean;
  onLogout: () => void;
}) {
  return (
    <aside className="sidenav">
      <div className="brand">
        <span className="brand-mark">A</span>
        <div>
          <strong>{configuration.brand}</strong>
          <small>{networkLabel}</small>
        </div>
      </div>
      <nav aria-label="Primary navigation">
        {tenantItems.map(([id, label, icon]) => (
          <button
            type="button"
            key={id}
            className={view === id ? "nav-item active" : "nav-item"}
            onClick={() => onView(id)}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
        {platformAccess && (
          <button
            type="button"
            className={view === "platform" ? "nav-item active" : "nav-item"}
            onClick={() => onView("platform")}
          >
            <UsersRound size={17} />
            <span>Platform admin</span>
          </button>
        )}
      </nav>
      <div className="sidenav-bottom">
        <div className="profile-chip">
          <Activity size={15} />
          <span>Live authority</span>
        </div>
        <Button variant="text" onClick={onLogout}>
          Sign out
        </Button>
      </div>
    </aside>
  );
}
