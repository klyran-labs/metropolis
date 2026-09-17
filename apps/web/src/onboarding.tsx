import { Building2, Check, ShieldCheck, Wallet } from "lucide-react";
import { useState } from "react";
import { request } from "./api";
import { Button, Mono, Surface, TextField } from "./design-system";
import { useIdentity } from "./identity";
import { useWallets } from "@privy-io/react-auth";

function ownershipMessage(subject: string, displayName: string) {
  return `AgentGuard organization ownership proof\nSubject: ${subject}\nOrganization: ${displayName}`;
}

export function TenantOnboarding({ identity }: { identity: ReturnType<typeof useIdentity> }) {
  const { wallets } = useWallets();
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const wallet = wallets[0];

  const createOrganization = async () => {
    if (!displayName.trim()) {
      setMessage("Choose a name for your organization.");
      return;
    }
    if (!wallet || !identity.subject) {
      setMessage("Connect an enterprise wallet to continue.");
      return;
    }
    setWorking(true);
    setMessage("Confirm ownership with your enterprise wallet…");
    try {
      const provider = await wallet.getEthereumProvider();
      const proof = ownershipMessage(identity.subject, displayName.trim());
      const signature = (await provider.request({
        method: "personal_sign",
        params: [proof, wallet.address],
      })) as string;
      await request("/onboarding/tenant", {
        method: "POST",
        body: JSON.stringify({
          displayName: displayName.trim(),
          enterpriseAddress: wallet.address,
          signature,
        }),
      });
      try {
        localStorage.setItem("agentguard_tenant_name", displayName.trim());
      } catch {
        // Ignore storage errors in restricted contexts
      }
      setMessage("Organization created. Preparing your control plane…");
      await identity.refreshIdentity();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The organization could not be created.",
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="onboarding-page">
      <div className="onboarding-shell">
        <div className="onboarding-brand">
          <span className="brand-mark">A</span>
          <span>Workspace setup</span>
        </div>
        <div className="onboarding-grid">
          <section className="onboarding-intro">
            <span className="eyebrow">Your control plane</span>
            <h1>Create your organization workspace.</h1>
            <p>
              Your workspace is a private operating boundary for agents,
              policy, settlement, and access. You will be the first
              organization administrator.
            </p>
            <div className="onboarding-points">
              <div>
                <ShieldCheck size={18} />
                <span>Membership and roles are private to your organization.</span>
              </div>
              <div>
                <Wallet size={18} />
                <span>Your enterprise wallet remains non-custodial.</span>
              </div>
              <div>
                <Check size={18} />
                <span>You can begin with an empty fleet and add agents when ready.</span>
              </div>
            </div>
          </section>
          <Surface className="onboarding-card">
            <div className="onboarding-card-icon">
              <Building2 size={20} />
            </div>
            <span className="eyebrow">First step</span>
            <h2>Name your organization</h2>
            <p>
              This is the private boundary for every agent and financial
              record you create.
            </p>
            <TextField
              label="Organization name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={160}
              autoFocus
            />
            <div className="wallet-proof">
              <span className="status-dot status-dot-success" />
              <div>
                <strong>Enterprise wallet</strong>
                <small>
                  {wallet ? (
                    <Mono>
                      {wallet.address.slice(0, 7)}…{wallet.address.slice(-5)}
                    </Mono>
                  ) : (
                    "Wallet connection required"
                  )}
                </small>
              </div>
            </div>
            <Button
              className="onboarding-submit"
              onClick={() => void createOrganization()}
              disabled={working || !wallet}
            >
              {working ? "Creating workspace…" : "Create workspace"}
            </Button>
            {message && <p className="form-message">{message}</p>}
          </Surface>
        </div>
      </div>
    </main>
  );
}
