import { useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as echarts from "echarts";
import { encodeFunctionData, parseAbi } from "viem";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAgents,
  useAgentPolicy,
  usePlans,
  usePlatformLedger,
  usePlatformPlans,
  usePlatformTenants,
  useSigningWallets,
  useTenantOperators,
  useSubscription,
  request,
  type Agent,
  type Checkout,
  type Plan,
  type PolicyUpdate,
} from "./api";
import { configuration } from "./configuration";
import { Button, EmptyState, Metric, Surface } from "./design-system";
import { useIdentity } from "./identity";
import { useWallets } from "@privy-io/react-auth";

async function waitForReceipt(
  provider: {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  },
  transactionHash: string,
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [transactionHash],
    })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status === "0x0") {
        throw new Error("The settlement approval was rejected by the network.");
      }
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 750));
  }
  throw new Error("The settlement approval did not reach finality in time.");
}

const fleetFeatures = tableFeatures({});
const fleetColumnHelper = createColumnHelper<typeof fleetFeatures, Agent>();
const fleetColumns = fleetColumnHelper.columns([
  fleetColumnHelper.accessor("address", { header: "Agent" }),
  fleetColumnHelper.accessor("environment", { header: "Environment" }),
  fleetColumnHelper.accessor("riskTier", { header: "Risk tier" }),
  fleetColumnHelper.accessor("status", { header: "State" }),
]);

function TelemetryChart() {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!element.current) return;
    const chart = echarts.init(element.current);
    chart.setOption({
      animation: false,
      xAxis: { type: "category", data: [] },
      yAxis: { type: "value" },
      series: [{ type: "line", data: [] }],
    });
    return () => chart.dispose();
  }, []);
  return (
    <div className="chart">
      <div ref={element} />
      <EmptyState
        title="No finalized telemetry yet"
        detail="The chart will appear after the chain indexer observes real events for this tenant."
      />
    </div>
  );
}

export function Overview() {
  const identity = useIdentity();
  const agents = useAgents(Boolean(identity.authenticated));
  const subscription = useSubscription(Boolean(identity.authenticated));
  const active =
    agents.data?.filter((agent) => agent.status === "active").length ?? 0;
  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Tenant workspace</span>
          <h1>Operational overview</h1>
          <p>
            Govern agent activity from one tenant boundary with chain-derived
            evidence.
          </p>
        </div>
        <span className="scope-badge">
          {identity.tenantId || "Tenant membership pending"}
        </span>
      </header>
      <div className="metric-grid">
        <Metric
          label="Registered agents"
          value={String(agents.data?.length ?? 0)}
          detail={agents.isLoading ? "Loading live data" : `${active} active`}
        />
        <Metric
          label="Subscription"
          value={
            subscription.data?.subscription
              ? String(subscription.data.subscription.status ?? "Recorded")
              : "Not configured"
          }
          detail="PostgreSQL authority"
        />
        <Metric
          label="Access surface"
          value={identity.platformAccess ? "Platform enabled" : "Tenant mode"}
          detail="Server capability check"
        />
      </div>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Spend telemetry</h2>
            <p>Only finalized chain events are eligible for visualization.</p>
          </div>
          <span className="icon-badge">⌁</span>
        </div>
        <TelemetryChart />
      </Surface>
    </div>
  );
}

export function Fleet() {
  const identity = useIdentity();
  const query = useAgents(Boolean(identity.authenticated));
  const client = useQueryClient();
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState("");
  const parent = useRef<HTMLDivElement>(null);
  const rows = query.data ?? [];
  const table = useTable({
    data: rows,
    columns: fleetColumns,
    features: fleetFeatures,
  });
  const virtual = useVirtualizer({
    count: table.getRowModel().rows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 52,
    overscan: 8,
  });
  const register = async () => {
    setMessage("");
    try {
      await request("/agents", {
        method: "POST",
        body: JSON.stringify({
          address,
          environment: "production",
          riskTier: "tier2_standard",
        }),
      });
      setMessage("Agent registered in the tenant fleet.");
      setAddress("");
      void client.invalidateQueries({ queryKey: ["agents"] });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The agent could not be registered.",
      );
    }
  };
  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Tenant operations</span>
          <h1>Fleet</h1>
          <p>Every row is scoped to the authenticated tenant.</p>
        </div>
      </header>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Register an agent</h2>
            <p>
              Provide an existing wallet address. Key material never enters this
              service.
            </p>
          </div>
        </div>
        <div className="inline-form">
          <input
            aria-label="Agent address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="0x wallet address"
          />
          <Button onClick={register} disabled={!address}>
            Register
          </Button>
        </div>
        {message && <p className="form-message">{message}</p>}
      </Surface>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Tenant fleet</h2>
            <p>{rows.length} real records returned for this tenant.</p>
          </div>
        </div>
        {query.isError ? (
          <EmptyState
            title="Fleet unavailable"
            detail="The tenant fleet could not be loaded right now."
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No agents registered"
            detail="Register the first controlled wallet to begin policy governance."
          />
        ) : (
          <div className="table-viewport" ref={parent}>
            <table>
              <thead>
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => (
                      <th key={header.id}>
                        {header.isPlaceholder ? null : (
                          <table.FlexRender header={header} />
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {virtual.getVirtualItems().map((item) => {
                  const row = table.getRowModel().rows[item.index];
                  return (
                    <tr key={row.id} style={{ height: item.size }}>
                      {row.getAllCells().map((cell) => (
                        <td key={cell.id}>
                          <table.FlexRender cell={cell} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Surface>
    </div>
  );
}

export function Policy() {
  const identity = useIdentity();
  const agents = useAgents(Boolean(identity.authenticated));
  const [agent, setAgent] = useState("");
  const policy = useAgentPolicy(agent, Boolean(identity.authenticated));
  const { wallets } = useWallets();
  const [draft, setDraft] = useState<PolicyUpdate>({
    maxPerTx: "0",
    maxPerWindow: "0",
    windowSeconds: 3600,
    maxVelocity: 1,
    killSwitch: false,
    whitelistEnabled: false,
  });
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!policy.data) return;
    setDraft({
      maxPerTx: String(policy.data.maxPerTx ?? "0"),
      maxPerWindow: String(policy.data.maxPerWindow ?? "0"),
      windowSeconds: Number(policy.data.windowSeconds ?? 3600),
      maxVelocity: Number(policy.data.maxVelocity ?? 1),
      killSwitch: Boolean(policy.data.killSwitch),
      whitelistEnabled: Boolean(policy.data.whitelistEnabled),
    });
  }, [policy.data]);
  const publish = async () => {
    const wallet = wallets[0];
    if (!agent || !wallet) {
      setMessage("Connect the tenant control wallet before publishing policy.");
      return;
    }
    try {
      setMessage("Preparing the policy change…");
      const prepared = await request<{ target: string; data: string }>(
        `/agents/${encodeURIComponent(agent)}/policy`,
        { method: "POST", body: JSON.stringify(draft) },
      );
      const provider = await wallet.getEthereumProvider();
      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          { from: wallet.address, to: prepared.target, data: prepared.data },
        ],
      })) as string;
      await waitForReceipt(provider, hash);
      setMessage("Policy change confirmed on the settlement network.");
      void policy.refetch();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The policy change could not be completed.",
      );
    }
  };
  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Tenant controls</span>
          <h1>Policy</h1>
          <p>
            Policy changes require tenant authority and are enforced on Monad.
          </p>
        </div>
      </header>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Onchain policy state</h2>
            <p>Read directly from the verified policy contract.</p>
          </div>
        </div>
        <select
          aria-label="Agent policy"
          value={agent}
          onChange={(event) => setAgent(event.target.value)}
        >
          <option value="">Select a tenant-owned agent</option>
          {agents.data?.map((item) => (
            <option key={item.address} value={item.address}>
              {item.address}
            </option>
          ))}
        </select>
        <div className="form-grid">
          <input
            aria-label="Maximum per transaction"
            value={draft.maxPerTx}
            onChange={(event) =>
              setDraft({ ...draft, maxPerTx: event.target.value })
            }
            placeholder="Maximum per transaction"
          />
          <input
            aria-label="Maximum per window"
            value={draft.maxPerWindow}
            onChange={(event) =>
              setDraft({ ...draft, maxPerWindow: event.target.value })
            }
            placeholder="Maximum per window"
          />
          <input
            aria-label="Window duration"
            type="number"
            min={1}
            value={draft.windowSeconds}
            onChange={(event) =>
              setDraft({ ...draft, windowSeconds: Number(event.target.value) })
            }
            placeholder="Window duration in seconds"
          />
          <input
            aria-label="Velocity limit"
            type="number"
            min={1}
            value={draft.maxVelocity}
            onChange={(event) =>
              setDraft({ ...draft, maxVelocity: Number(event.target.value) })
            }
            placeholder="Velocity limit"
          />
          <label className="check-field">
            <input
              type="checkbox"
              checked={draft.killSwitch}
              onChange={(event) =>
                setDraft({ ...draft, killSwitch: event.target.checked })
              }
            />
            Pause agent activity
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={draft.whitelistEnabled}
              onChange={(event) =>
                setDraft({ ...draft, whitelistEnabled: event.target.checked })
              }
            />
            Require approved merchants
          </label>
          <Button onClick={() => void publish()} disabled={!agent}>
            Publish policy
          </Button>
        </div>
        {message && <p className="form-message">{message}</p>}
        {policy.isError ? (
          <EmptyState
            title="Policy unavailable"
            detail="The selected policy could not be read from Monad."
          />
        ) : policy.data ? (
          <pre className="record">{JSON.stringify(policy.data, null, 2)}</pre>
        ) : (
          <EmptyState
            title="No policy selected"
            detail="Choose an agent to inspect its chain-derived limits."
          />
        )}
      </Surface>
    </div>
  );
}

export function Billing() {
  const identity = useIdentity();
  const subscription = useSubscription(Boolean(identity.authenticated));
  const plans = usePlans(Boolean(identity.authenticated));
  const { wallets } = useWallets();
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const settle = async (planPriceId: string) => {
    const wallet = wallets[0];
    const guard = configuration.contracts.agentWalletGuard;
    if (!wallet || !guard) {
      setMessage(
        "Connect a settlement wallet and configure the verified payment guard.",
      );
      return;
    }
    setWorking(true);
    setMessage("Creating a signed settlement intent…");
    try {
      const checkout = await request<Checkout>("/subscription/checkout", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ planPriceId, agent: wallet.address }),
      });
      const provider = await wallet.getEthereumProvider();
      const payment = checkout.settlement.request;
      const typedData = {
        domain: {
          name: "AgentGuard_PolicyEngine",
          version: "1",
          chainId: checkout.settlement.chainId,
          verifyingContract: guard,
        },
        types: {
          SpendRequest: [
            { name: "agent", type: "address" },
            { name: "merchant", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "category", type: "bytes32" },
            { name: "timestamp", type: "uint256" },
            { name: "deadline", type: "uint256" },
            { name: "nonce", type: "uint256" },
          ],
        },
        primaryType: "SpendRequest",
        message: payment,
      };
      const signature = (await provider.request({
        method: "eth_signTypedData_v4",
        params: [wallet.address, JSON.stringify(typedData)],
      })) as string;
      const approveData = encodeFunctionData({
        abi: parseAbi([
          "function approve(address spender, uint256 amount) returns (bool)",
        ]),
        functionName: "approve",
        args: [guard, BigInt(payment.amount)],
      });
      const approvalHash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: wallet.address,
            to: checkout.settlement.tokenAddress,
            data: approveData,
          },
        ],
      })) as string;
      await waitForReceipt(provider, approvalHash);
      const executeData = encodeFunctionData({
        abi: parseAbi([
          "function executeGatedPayment((address agent,address merchant,uint256 amount,bytes32 category,uint256 timestamp,uint256 deadline,uint256 nonce) req, bytes signature, address token, bytes extraCallData) returns (bool success)",
        ]),
        functionName: "executeGatedPayment",
        args: [
          {
            agent: payment.agent as `0x${string}`,
            merchant: payment.merchant as `0x${string}`,
            amount: BigInt(payment.amount),
            category: payment.category as `0x${string}`,
            timestamp: BigInt(payment.timestamp),
            deadline: BigInt(payment.deadline),
            nonce: BigInt(payment.nonce),
          },
          signature as `0x${string}`,
          checkout.settlement.tokenAddress as `0x${string}`,
          "0x",
        ],
      });
      const transactionHash = (await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: wallet.address, to: guard, data: executeData }],
      })) as string;
      await waitForReceipt(provider, transactionHash);
      await request(`/billing/payments/${checkout.paymentId}/submit`, {
        method: "POST",
        body: JSON.stringify({ transactionHash }),
      });
      setMessage(
        "Settlement submitted. Subscription activation will follow receipt confirmation.",
      );
      void subscription.refetch();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The settlement could not be completed.",
      );
    } finally {
      setWorking(false);
    }
  };
  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Tenant finance</span>
          <h1>Subscription</h1>
          <p>
            Onchain settlement becomes active only after a verified receipt.
          </p>
        </div>
      </header>
      <Surface>
        {message && <p className="form-message">{message}</p>}
        {plans.isError ? (
          <EmptyState
            title="Plan catalog unavailable"
            detail="A real plan catalog is required before checkout."
          />
        ) : plans.data?.length ? (
          <div className="plan-list">
            {plans.data.flatMap((plan) =>
              plan.prices.map((price) => (
                <div className="plan-row" key={price.id}>
                  <strong>{plan.name}</strong>
                  <span>
                    {price.interval} · {price.amountBaseUnits} base units
                  </span>
                  <Button
                    onClick={() => void settle(price.id)}
                    disabled={working}
                  >
                    Subscribe
                  </Button>
                </div>
              )),
            )}
          </div>
        ) : (
          <EmptyState
            title="No subscription plans"
            detail="A platform administrator must publish a real plan before checkout is available."
          />
        )}
      </Surface>
      <Surface>
        {subscription.isError ? (
          <EmptyState
            title="Subscription unavailable"
            detail="The billing authority did not return a usable response."
          />
        ) : subscription.data?.subscription ? (
          <pre className="record">
            {JSON.stringify(subscription.data.subscription, null, 2)}
          </pre>
        ) : (
          <EmptyState
            title="No subscription"
            detail="A platform administrator must publish a real plan before this tenant can subscribe."
          />
        )}
      </Surface>
    </div>
  );
}

export function Settings() {
  const identity = useIdentity();
  const operators = useTenantOperators(Boolean(identity.authenticated));
  const signingWallets = useSigningWallets(Boolean(identity.authenticated));
  const [label, setLabel] = useState("");
  const [vaultMessage, setVaultMessage] = useState("");
  const provisionSigningAddress = async () => {
    if (!label.trim()) {
      setVaultMessage("Provide a label for the signing address.");
      return;
    }
    try {
      await request("/signing/vault", {
        method: "POST",
        body: JSON.stringify({ label }),
      });
      setLabel("");
      setVaultMessage(
        "Signing address provisioned in the sovereign key vault.",
      );
      void signingWallets.refetch();
    } catch (error) {
      setVaultMessage(
        error instanceof Error
          ? error.message
          : "The signing address could not be provisioned.",
      );
    }
  };
  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Tenant governance</span>
          <h1>Settings</h1>
          <p>
            Roles, policy conditions, and identity controls are managed by the
            organization authority.
          </p>
        </div>
      </header>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Organization access</h2>
            <p>Membership and role decisions are controlled by PostgreSQL.</p>
          </div>
          <span className="scope-badge">{identity.role || "Role pending"}</span>
        </div>
        {operators.isError ? (
          <EmptyState
            title="Access directory restricted"
            detail="Only organization administrators can inspect the full membership directory."
          />
        ) : operators.data?.length ? (
          <div className="plan-list">
            {operators.data.map((operator) => (
              <div className="plan-row" key={operator.subject}>
                <strong>{operator.subject}</strong>
                <span>{operator.role}</span>
                <small>{operator.status}</small>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No additional operators"
            detail="Invite and provision operators through the organization access workflow."
          />
        )}
      </Surface>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Sovereign key vault</h2>
            <p>
              Provision non-exportable agent signing addresses without sending
              private credentials to the gateway.
            </p>
          </div>
        </div>
        <div className="inline-form">
          <input
            aria-label="Signing address label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Signing address label"
          />
          <Button onClick={() => void provisionSigningAddress()}>
            Provision address
          </Button>
        </div>
        {vaultMessage && <p className="form-message">{vaultMessage}</p>}
        {signingWallets.isError ? (
          <EmptyState
            title="Key vault unavailable"
            detail="The Sovereign Key Vault is not available to this tenant."
          />
        ) : signingWallets.data?.length ? (
          <div className="plan-list">
            {signingWallets.data.map((wallet) => (
              <div className="plan-row" key={wallet.walletId}>
                <strong>{wallet.label}</strong>
                <span>{wallet.address}</span>
                <small>Sealed</small>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No signing addresses"
            detail="Provision a sealed address when an autonomous agent is ready to operate."
          />
        )}
      </Surface>
    </div>
  );
}

export function Platform() {
  const identity = useIdentity();
  const plans = usePlatformPlans(identity.platformAccess);
  const tenants = usePlatformTenants(identity.platformAccess);
  const ledger = usePlatformLedger(identity.platformAccess);
  const [form, setForm] = useState({
    code: "",
    name: "",
    description: "",
    amount: "",
    token: configuration.contracts.settlementToken ?? "",
    interval: "monthly",
  });
  const [message, setMessage] = useState("");
  const create = async () => {
    try {
      await request("/platform/plans", {
        method: "POST",
        body: JSON.stringify({
          code: form.code,
          name: form.name,
          description: form.description,
          prices: [
            {
              chainId: configuration.chainId,
              tokenAddress: form.token,
              amountBaseUnits: form.amount,
              interval: form.interval,
            },
          ],
        }),
      });
      setMessage("Plan created.");
      void plans.refetch();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The plan could not be created.",
      );
    }
  };
  const fields = ["code", "name", "description", "amount", "token"] as const;
  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Platform administration</span>
          <h1>Plans and billing</h1>
          <p>Publish real prices and monitor verified settlement records.</p>
        </div>
        <span className="scope-badge">Platform role required</span>
      </header>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Create a plan</h2>
            <p>
              Prices must be bound to the active chain and configured settlement
              token.
            </p>
          </div>
        </div>
        <div className="form-grid">
          {fields.map((key) => (
            <input
              key={key}
              value={form[key]}
              onChange={(event) =>
                setForm({ ...form, [key]: event.target.value })
              }
              placeholder={
                key === "amount"
                  ? "Amount in base units"
                  : key === "token"
                    ? "Settlement token address"
                    : key
              }
            />
          ))}
          <select
            value={form.interval}
            onChange={(event) =>
              setForm({ ...form, interval: event.target.value })
            }
          >
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
          <Button onClick={create}>Publish plan</Button>
        </div>
        {message && <p className="form-message">{message}</p>}
      </Surface>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Tenant directory</h2>
            <p>
              Platform operators can see lifecycle state without entering a
              tenant workspace.
            </p>
          </div>
        </div>
        {tenants.isError ? (
          <EmptyState
            title="Tenant directory unavailable"
            detail="The platform tenant service did not return a usable response."
          />
        ) : tenants.data?.length ? (
          <div className="plan-list">
            {tenants.data.map((tenant) => (
              <div className="plan-row" key={tenant.id}>
                <strong>{tenant.displayName}</strong>
                <span>{tenant.status}</span>
                <small>{tenant.id}</small>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No tenants registered"
            detail="The platform directory is empty."
          />
        )}
      </Surface>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Billing ledger</h2>
            <p>Only confirmed onchain settlement entries appear here.</p>
          </div>
        </div>
        {ledger.isError ? (
          <EmptyState
            title="Billing ledger unavailable"
            detail="The platform billing service did not return a usable response."
          />
        ) : ledger.data?.length ? (
          <div className="table-viewport">
            <table>
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Entry</th>
                  <th>Amount</th>
                  <th>Network</th>
                </tr>
              </thead>
              <tbody>
                {ledger.data.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.tenantName}</td>
                    <td>{entry.entryType}</td>
                    <td>{entry.amountBaseUnits}</td>
                    <td>{entry.chainId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No confirmed billing entries"
            detail="Confirmed subscription settlements will appear here."
          />
        )}
      </Surface>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Plan catalog</h2>
            <p>Catalog entries are loaded from PostgreSQL.</p>
          </div>
        </div>
        {plans.isError || !identity.platformAccess ? (
          <EmptyState
            title="Platform catalog unavailable"
            detail="A platform role and healthy gateway are required to view plans."
          />
        ) : plans.data?.length ? (
          <div className="plan-list">
            {plans.data.map((plan: Plan) => (
              <div className="plan-row" key={plan.id}>
                <strong>{plan.name}</strong>
                <span>{plan.code}</span>
                <small>{plan.prices.length} price options</small>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No plans published"
            detail="Create the first real subscription plan when pricing is approved."
          />
        )}
      </Surface>
    </div>
  );
}
