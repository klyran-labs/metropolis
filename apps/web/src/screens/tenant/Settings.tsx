import { useState } from "react";
import { Tabs, tabPanelProps } from "../../design-system";
import { useIdentity } from "../../identity";
import { TeamTab } from "./settings/TeamTab";
import { CredentialsTab } from "./settings/CredentialsTab";
import { PolicyTab } from "./settings/PolicyTab";
import { PricingTab } from "./settings/PricingTab";

type SettingsTab = "team" | "credentials" | "policy" | "pricing";
const TAB_LABEL: Record<SettingsTab, string> = {
  team: "Team",
  credentials: "Credentials",
  policy: "Policy",
  pricing: "AI Rate Cards",
};

export function Settings() {
  const identity = useIdentity();
  const [tab, setTab] = useState<SettingsTab>("team");
  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <h1>Settings</h1>
          <p>Team permissions, credentials, policy parameters, and AI rate cards.</p>
        </div>
      </header>
      <Tabs
        className="settings-tabs"
        idPrefix="settings"
        label="Settings sections"
        items={(Object.keys(TAB_LABEL) as SettingsTab[]).map((key) => ({ key, label: TAB_LABEL[key] }))}
        active={tab}
        onChange={(key) => setTab(key as SettingsTab)}
      />
      <div {...tabPanelProps("settings", tab, tab)} className="stack">
        {tab === "team" && <TeamTab identity={identity} />}
        {tab === "credentials" && <CredentialsTab identity={identity} />}
        {tab === "policy" && <PolicyTab identity={identity} />}
        {tab === "pricing" && <PricingTab identity={identity} />}
      </div>
    </div>
  );
}

