import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import {
  type AbacPolicy,
  type ApiKey,
  type IssuedApiKey,
  type CalculateToolCallRequest,
  type ModelCatalogEntry,
  type ModelRateOverride,
  type PbacPolicy,
  type PricingModelType,
  type ToolCatalogEntry,
  type ToolRateOverride,
  type VolumeTier,
  useAbacPolicy,
  useAgents,
  useApiKeys,
  useCalculateSpend,
  useCreateApiKey,
  useDeactivatePbacPolicy,
  usePbacPolicies,
  usePutAbacPolicy,
  useRevokeApiKey,
  useRotateApiKey,
  useTenantOperators,
  useTenantPricingModel,
  useUpdateTenantPricingModel,
  useUpsertPbacPolicy,
} from "../../api";
import { Badge, Button, Dialog, EmptyState, Mono, Surface, TextField, roleLabel, truncateMiddle } from "../../design-system";
import { useIdentity, type Identity } from "../../identity";

const ASSIGNABLE_CAPABILITIES = [
  { value: "fleet.read", label: "Read fleet" },
  { value: "audit.read", label: "Read audit" },
  { value: "telemetry.subscribe", label: "Subscribe telemetry" },
  { value: "policy.write", label: "Author policy" },
  { value: "circuit_breaker.trip", label: "Trip circuit breaker" },
  { value: "treasury.manage", label: "Manage treasury" },
  { value: "settlement.dispatch", label: "Dispatch settlement" },
] as const;

function canManageSecurity(role: string | null | undefined): boolean {
  return role === "super_admin" || role === "sec_ops";
}

function defaultExpiryInput(): string {
  const date = new Date();
  date.setDate(date.getDate() + 90);
  return date.toISOString().slice(0, 10);
}

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
          <span className="eyebrow">Home / Settings</span>
          <h1>Settings</h1>
          <p>Manage who's on your team, what they can do, how your agent wallets are secured, and AI provider rate cards.</p>
        </div>
      </header>
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {(Object.keys(TAB_LABEL) as SettingsTab[]).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? "workspace-tab active" : "workspace-tab"}
            onClick={() => setTab(item)}
          >
            {TAB_LABEL[item]}
          </button>
        ))}
      </div>
      {tab === "team" && <TeamTab identity={identity} />}
      {tab === "credentials" && <CredentialsTab identity={identity} />}
      {tab === "policy" && <PolicyTab identity={identity} />}
      {tab === "pricing" && <PricingTab identity={identity} />}
    </div>
  );
}

function TeamTab({ identity }: { identity: Identity }) {
  const operators = useTenantOperators(Boolean(identity.authenticated));
  const agents = useAgents(Boolean(identity.authenticated));
  const managedWallets = (agents.data ?? []).filter((agent) => agent.walletSource === "sovereign");
  return (
    <>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Team access</h2>
            <p>Everyone with access to this organization, and what they're allowed to do.</p>
          </div>
          <Badge tone="info">{roleLabel(identity.role)}</Badge>
        </div>
        {operators.isError ? (
          <EmptyState
            title="Access list restricted"
            detail="Only organization administrators can see the full team list."
          />
        ) : operators.data?.length ? (
          <div className="entity-list">
            {operators.data.map((operator) => (
              <div className="entity-row" key={operator.subject}>
                <strong><Mono>{operator.subject}</Mono></strong>
                <Badge tone="neutral">{roleLabel(operator.role)}</Badge>
                <small>{operator.status}</small>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No other teammates yet"
            detail="Ask an administrator to add more people to this organization."
          />
        )}
      </Surface>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Agent wallets</h2>
            <p>Wallets we generated and sealed on behalf of your agents. The private key never leaves our vault.</p>
          </div>
          <Link to="/app/fleet" className="control control-text">
            Register an agent
            <ArrowRight size={14} />
          </Link>
        </div>
        {agents.isError ? (
          <EmptyState title="Wallets unavailable" detail="We couldn't load your agent wallets right now." />
        ) : managedWallets.length ? (
          <div className="entity-list">
            {managedWallets.map((agent) => (
              <div className="entity-row" key={agent.address}>
                <strong><Mono>{agent.address}</Mono></strong>
                <Badge tone="neutral">{agent.environment}</Badge>
                <Badge tone="success">Sealed</Badge>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No managed wallets yet"
            detail="Register an agent with an auto-generated wallet in Fleet to see it here."
          />
        )}
      </Surface>
    </>
  );
}

function credentialStatus(key: ApiKey): { label: string; tone: "success" | "warning" | "neutral" } {
  if (key.revokedAt) return { label: "Revoked", tone: "neutral" };
  if (key.expiresAt && new Date(key.expiresAt) <= new Date()) return { label: "Expired", tone: "warning" };
  return { label: "Active", tone: "success" };
}

function CredentialsTab({ identity }: { identity: Identity }) {
  const canManage = canManageSecurity(identity.role);
  const apiKeys = useApiKeys(canManage);
  const agents = useAgents(canManage);

  const [formOpen, setFormOpen] = useState(false);
  const [rotateTarget, setRotateTarget] = useState<ApiKey | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [issued, setIssued] = useState<IssuedApiKey | null>(null);
  const [formError, setFormError] = useState("");

  const [agentAddress, setAgentAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [capabilities, setCapabilities] = useState<string[]>(["fleet.read"]);
  const [expiresAt, setExpiresAt] = useState(defaultExpiryInput());
  const [rotateExpiresAt, setRotateExpiresAt] = useState(defaultExpiryInput());

  const create = useCreateApiKey((key) => {
    setIssued(key);
    void apiKeys.refetch();
  });
  const rotate = useRotateApiKey((key) => {
    setIssued(key);
    void apiKeys.refetch();
  });
  const revoke = useRevokeApiKey(() => {
    setRevokeTarget(null);
    void apiKeys.refetch();
  });

  const openCreate = () => {
    setAgentAddress("");
    setSubject("");
    setCapabilities(["fleet.read"]);
    setExpiresAt(defaultExpiryInput());
    setFormError("");
    setIssued(null);
    setFormOpen(true);
  };
  const closeForm = () => {
    setFormOpen(false);
    setIssued(null);
    setFormError("");
  };
  const openRotate = (key: ApiKey) => {
    setRotateExpiresAt(defaultExpiryInput());
    setFormError("");
    setIssued(null);
    setRotateTarget(key);
  };
  const closeRotate = () => {
    setRotateTarget(null);
    setIssued(null);
    setFormError("");
  };

  if (!canManage) {
    return (
      <Surface>
        <EmptyState
          title="Access restricted"
          detail="Only security administrators can manage machine credentials."
        />
      </Surface>
    );
  }

  return (
    <Surface>
      <div className="section-heading">
        <div>
          <h2>Machine credentials</h2>
          <p>Scoped, expiring credentials an agent's automation can use to call the gateway directly.</p>
        </div>
        <Button onClick={openCreate}>New credential</Button>
      </div>
      {apiKeys.isError ? (
        <EmptyState title="Credentials unavailable" detail="We couldn't load machine credentials right now." />
      ) : apiKeys.data?.length ? (
        <div className="entity-list">
          {apiKeys.data.map((key) => {
            const status = credentialStatus(key);
            return (
              <div className="entity-row" key={key.id}>
                <strong><Mono>{key.keyPrefix}…</Mono></strong>
                <span>{key.subject}</span>
                <Mono>{truncateMiddle(key.agentAddress)}</Mono>
                <Badge tone={status.tone}>{status.label}</Badge>
                {!key.revokedAt && (
                  <>
                    <Button variant="text" onClick={() => openRotate(key)}>Rotate</Button>
                    <Button variant="text" onClick={() => setRevokeTarget(key)}>Revoke</Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No credentials yet" detail="Issue a scoped credential for an agent's automation above." />
      )}

      <Dialog
        open={formOpen}
        onClose={closeForm}
        title={issued ? "Save this secret" : "New machine credential"}
        description={
          issued
            ? "This is the only time the full secret is shown. Store it in your agent's secret manager now."
            : "Scope the credential to a single agent and only the capabilities its automation needs."
        }
        footer={
          issued ? (
            <Button onClick={closeForm}>Done</Button>
          ) : (
            <>
              <Button variant="text" onClick={closeForm}>Cancel</Button>
              <Button
                onClick={() => {
                  setFormError("");
                  if (!agentAddress) return setFormError("Choose an agent.");
                  if (!subject.trim()) return setFormError("Give the credential a subject.");
                  if (capabilities.length === 0) return setFormError("Select at least one capability.");
                  create.mutate(
                    { agentAddress, subject: subject.trim(), capabilities, expiresAt: new Date(expiresAt).toISOString() },
                    { onError: (error) => setFormError(error instanceof Error ? error.message : "The credential could not be issued.") },
                  );
                }}
                disabled={create.isPending}
              >
                {create.isPending ? "Issuing…" : "Issue credential"}
              </Button>
            </>
          )
        }
      >
        {issued ? (
          <Mono className="credential-secret-value">{issued.secret}</Mono>
        ) : (
          <div className="form-grid">
            <select aria-label="Agent" value={agentAddress} onChange={(event) => setAgentAddress(event.target.value)}>
              <option value="">Select an agent</option>
              {agents.data?.map((agent) => (
                <option key={agent.address} value={agent.address}>
                  {truncateMiddle(agent.address)} · {agent.environment}
                </option>
              ))}
            </select>
            <TextField label="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
            <div className="capability-checkboxes">
              {ASSIGNABLE_CAPABILITIES.map((capability) => (
                <label key={capability.value}>
                  <input
                    type="checkbox"
                    checked={capabilities.includes(capability.value)}
                    onChange={(event) =>
                      setCapabilities((current) =>
                        event.target.checked
                          ? [...current, capability.value]
                          : current.filter((value) => value !== capability.value),
                      )
                    }
                  />
                  {capability.label}
                </label>
              ))}
            </div>
            <TextField label="Expires" type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
            {formError && <p className="form-message">{formError}</p>}
          </div>
        )}
      </Dialog>

      <Dialog
        open={Boolean(rotateTarget)}
        onClose={closeRotate}
        title={issued ? "Save this secret" : "Rotate credential"}
        description={
          issued
            ? "This is the only time the full secret is shown. Store it in your agent's secret manager now."
            : `Issue a new secret for ${rotateTarget ? truncateMiddle(rotateTarget.agentAddress) : "this agent"} and revoke the current one.`
        }
        footer={
          issued ? (
            <Button onClick={closeRotate}>Done</Button>
          ) : (
            <>
              <Button variant="text" onClick={closeRotate}>Cancel</Button>
              <Button
                onClick={() => {
                  if (!rotateTarget) return;
                  setFormError("");
                  rotate.mutate(
                    { id: rotateTarget.id, expiresAt: new Date(rotateExpiresAt).toISOString() },
                    { onError: (error) => setFormError(error instanceof Error ? error.message : "The credential could not be rotated.") },
                  );
                }}
                disabled={rotate.isPending}
              >
                {rotate.isPending ? "Rotating…" : "Rotate"}
              </Button>
            </>
          )
        }
      >
        {issued ? (
          <Mono className="credential-secret-value">{issued.secret}</Mono>
        ) : (
          <div className="form-grid">
            <TextField label="New expiry" type="date" value={rotateExpiresAt} onChange={(event) => setRotateExpiresAt(event.target.value)} />
            {formError && <p className="form-message">{formError}</p>}
          </div>
        )}
      </Dialog>

      <Dialog
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        title="Revoke credential"
        description={revokeTarget ? `This immediately disables ${revokeTarget.keyPrefix}…. This cannot be undone.` : ""}
        footer={
          <>
            <Button variant="text" onClick={() => setRevokeTarget(null)}>Cancel</Button>
            <Button onClick={() => revokeTarget && revoke.mutate(revokeTarget.id)} disabled={revoke.isPending}>
              {revoke.isPending ? "Revoking…" : "Revoke"}
            </Button>
          </>
        }
      >
        <p>The agent's automation using this credential will immediately lose access.</p>
      </Dialog>
    </Surface>
  );
}

function PolicyTab({ identity }: { identity: Identity }) {
  const canManage = canManageSecurity(identity.role);
  const policies = usePbacPolicies(canManage);
  const abac = useAbacPolicy(canManage);

  const [pbacDialogOpen, setPbacDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<PbacPolicy | null>(null);
  const [pbacError, setPbacError] = useState("");
  const [effect, setEffect] = useState<"allow" | "deny">("allow");
  const [principals, setPrincipals] = useState("*");
  const [actions, setActions] = useState("");
  const [resources, setResources] = useState("*");
  const [maxAmount, setMaxAmount] = useState("");
  const [requiredSignatures, setRequiredSignatures] = useState("");
  const [requireMfa, setRequireMfa] = useState(false);

  const upsertPolicy = useUpsertPbacPolicy(() => {
    setPbacDialogOpen(false);
    void policies.refetch();
  });
  const deactivatePolicy = useDeactivatePbacPolicy(() => void policies.refetch());

  const openCreateRule = () => {
    setEditingPolicy(null);
    setEffect("allow");
    setPrincipals("*");
    setActions("");
    setResources("*");
    setMaxAmount("");
    setRequiredSignatures("");
    setRequireMfa(false);
    setPbacError("");
    setPbacDialogOpen(true);
  };
  const openReviseRule = (policy: PbacPolicy) => {
    setEditingPolicy(policy);
    setEffect(policy.effect);
    setPrincipals(policy.principals.join(", "));
    setActions(policy.actions.join(", "));
    setResources(policy.resources.join(", "));
    setMaxAmount(policy.conditions.maxAmount ?? "");
    setRequiredSignatures(policy.conditions.requiredMultisigSignatures?.toString() ?? "");
    setRequireMfa(Boolean(policy.conditions.requireMfa));
    setPbacError("");
    setPbacDialogOpen(true);
  };

  const [abacForm, setAbacForm] = useState<AbacPolicy | null>(null);
  const [abacError, setAbacError] = useState("");
  const [abacMessage, setAbacMessage] = useState("");
  useEffect(() => {
    if (abac.data && !abacForm) setAbacForm(abac.data);
  }, [abac.data, abacForm]);
  const putAbac = usePutAbacPolicy(() => setAbacMessage("Organization controls saved."));

  if (!canManage) {
    return (
      <Surface>
        <EmptyState
          title="Access restricted"
          detail="Only security administrators can view or author authorization policy."
        />
      </Surface>
    );
  }

  return (
    <div className="stack">
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Access rules</h2>
            <p>Principal, action, and resource rules evaluated on every request. A deny always wins.</p>
          </div>
          <Button onClick={openCreateRule}>New rule</Button>
        </div>
        {policies.isError ? (
          <EmptyState title="Access rules unavailable" detail="We couldn't load authorization policy right now." />
        ) : policies.data?.length ? (
          <div className="entity-list">
            {policies.data.map((policy) => (
              <div className="entity-row" key={policy.id}>
                <Badge tone={policy.effect === "deny" ? "critical" : "success"}>{policy.effect}</Badge>
                <Mono>{policy.principals.join(", ") || "*"}</Mono>
                <Mono>{policy.actions.join(", ") || "*"}</Mono>
                <Mono>{policy.resources.join(", ") || "*"}</Mono>
                <small>v{policy.version}</small>
                <Button variant="text" onClick={() => openReviseRule(policy)}>Revise</Button>
                <Button variant="text" onClick={() => deactivatePolicy.mutate(policy.id)} disabled={deactivatePolicy.isPending}>
                  Retire
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No rules yet" detail="Author the first access rule for this organization above." />
        )}
      </Surface>

      <Surface>
        <div className="section-heading">
          <div>
            <h2>Organization controls</h2>
            <p>Network, MFA, and trading-window constraints applied to every request.</p>
          </div>
        </div>
        {abac.isError ? (
          <EmptyState title="Organization controls unavailable" detail="We couldn't load organization controls right now." />
        ) : abacForm ? (
          <div className="form-grid">
            <TextField
              label="Allowed networks (CIDR, comma-separated)"
              value={abacForm.allowedCidrs.join(", ")}
              onChange={(event) =>
                setAbacForm({
                  ...abacForm,
                  allowedCidrs: event.target.value.split(",").map((value) => value.trim()).filter(Boolean),
                })
              }
            />
            <TextField
              label="Trading window start (UTC hour)"
              type="number"
              min={0}
              max={24}
              value={abacForm.tradingStartHourUtc}
              onChange={(event) => setAbacForm({ ...abacForm, tradingStartHourUtc: Number(event.target.value) })}
            />
            <TextField
              label="Trading window end (UTC hour)"
              type="number"
              min={0}
              max={24}
              value={abacForm.tradingEndHourUtc}
              onChange={(event) => setAbacForm({ ...abacForm, tradingEndHourUtc: Number(event.target.value) })}
            />
            <label className="check-field">
              <input
                type="checkbox"
                checked={abacForm.requireMfa}
                onChange={(event) => setAbacForm({ ...abacForm, requireMfa: event.target.checked })}
              />
              Require MFA
            </label>
            <Button
              onClick={() => {
                setAbacError("");
                setAbacMessage("");
                putAbac.mutate(abacForm, {
                  onError: (error) =>
                    setAbacError(error instanceof Error ? error.message : "Organization controls could not be saved."),
                });
              }}
              disabled={putAbac.isPending}
            >
              {putAbac.isPending ? "Saving…" : "Save controls"}
            </Button>
            {abacError && <p className="form-message">{abacError}</p>}
            {abacMessage && <p className="form-message">{abacMessage}</p>}
          </div>
        ) : (
          <EmptyState title="Loading organization controls" detail="Hang tight." />
        )}
      </Surface>

      <Dialog
        open={pbacDialogOpen}
        onClose={() => setPbacDialogOpen(false)}
        title={editingPolicy ? "Revise access rule" : "New access rule"}
        description="Principals, actions, and resources accept glob patterns, such as treasury.* or a bare * for any."
        footer={
          <>
            <Button variant="text" onClick={() => setPbacDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                setPbacError("");
                if (!actions.trim()) return setPbacError("Specify at least one action pattern.");
                upsertPolicy.mutate(
                  {
                    id: editingPolicy?.id,
                    effect,
                    principals: principals.split(",").map((value) => value.trim()).filter(Boolean),
                    actions: actions.split(",").map((value) => value.trim()).filter(Boolean),
                    resources: resources.split(",").map((value) => value.trim()).filter(Boolean),
                    conditions: {
                      maxAmount: maxAmount.trim() || null,
                      requiredMultisigSignatures: requiredSignatures.trim() ? Number(requiredSignatures) : null,
                      requireMfa: requireMfa || null,
                      eligibleApproverRoles: [],
                    },
                  },
                  { onError: (error) => setPbacError(error instanceof Error ? error.message : "The access rule could not be saved.") },
                );
              }}
              disabled={upsertPolicy.isPending}
            >
              {upsertPolicy.isPending ? "Saving…" : "Save rule"}
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <select aria-label="Effect" value={effect} onChange={(event) => setEffect(event.target.value as "allow" | "deny")}>
            <option value="allow">Allow</option>
            <option value="deny">Deny</option>
          </select>
          <TextField label="Principals (comma-separated, * for any)" value={principals} onChange={(event) => setPrincipals(event.target.value)} />
          <TextField label="Actions (comma-separated, e.g. treasury.*)" value={actions} onChange={(event) => setActions(event.target.value)} />
          <TextField label="Resources (comma-separated, * for any)" value={resources} onChange={(event) => setResources(event.target.value)} />
          <TextField label="Max amount (base units, optional)" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} />
          <TextField
            label="Required multisig signatures (optional)"
            type="number"
            min={1}
            value={requiredSignatures}
            onChange={(event) => setRequiredSignatures(event.target.value)}
          />
          <label className="check-field">
            <input type="checkbox" checked={requireMfa} onChange={(event) => setRequireMfa(event.target.checked)} />
            Require MFA
          </label>
          {pbacError && <p className="form-message">{pbacError}</p>}
        </div>
      </Dialog>
    </div>
  );
}

function canManagePricing(role: string | null | undefined): boolean {
  return role === "super_admin" || role === "treasury" || role === "sec_ops";
}

function PricingTab({ identity }: { identity: Identity }) {
  const pricingQuery = useTenantPricingModel(Boolean(identity.authenticated));
  const updatePricing = useUpdateTenantPricingModel(() => {
    pricingQuery.refetch();
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 4000);
  });
  const calculateSpend = useCalculateSpend();

  const [modelType, setModelType] = useState<PricingModelType>("flat_discount");
  const [discountPercent, setDiscountPercent] = useState<string>("0");
  const [ptuCapacityM, setPtuCapacityM] = useState<string>("0");
  const [tokenCapM, setTokenCapM] = useState<string>("0");
  const [perCallFeeDollars, setPerCallFeeDollars] = useState<string>("0");
  const [volumeTiers, setVolumeTiers] = useState<VolumeTier[]>([]);
  const [customRates, setCustomRates] = useState<
    Record<string, { input: string; output: string; cacheRead: string; cacheWrite: string }>
  >({});
  const [toolCustomRates, setToolCustomRates] = useState<Record<string, { costPerCall: string }>>({});

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Simulator state
  const [simModel, setSimModel] = useState<string>("claude-3-7-sonnet");
  const [simInputTokens, setSimInputTokens] = useState<string>("150000");
  const [simOutputTokens, setSimOutputTokens] = useState<string>("25000");
  const [simCacheReadTokens, setSimCacheReadTokens] = useState<string>("50000");
  const [simCacheWriteTokens, setSimCacheWriteTokens] = useState<string>("10000");
  const [simIsBatch, setSimIsBatch] = useState<boolean>(false);
  const [simToolCounts, setSimToolCounts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (pricingQuery.data?.pricing) {
      const p = pricingQuery.data.pricing;
      setModelType(p.modelType);
      setDiscountPercent((p.discountBps / 100).toString());
      setPtuCapacityM((p.ptuCapacityTokens / 1_000_000).toString());
      setTokenCapM(p.tokenCapTokens ? (p.tokenCapTokens / 1_000_000).toString() : "0");
      setPerCallFeeDollars(p.perCallFeeMicroDollars ? (p.perCallFeeMicroDollars / 1_000_000).toString() : "0");
      setVolumeTiers(p.volumeTiers ?? []);

      const rates: Record<string, { input: string; output: string; cacheRead: string; cacheWrite: string }> = {};
      for (const [key, val] of Object.entries(p.customRates ?? {})) {
        rates[key] = {
          input: (val.inputPerMMicroDollars / 1_000_000).toString(),
          output: (val.outputPerMMicroDollars / 1_000_000).toString(),
          cacheRead: val.cacheReadPerMMicroDollars !== undefined ? (val.cacheReadPerMMicroDollars / 1_000_000).toString() : "",
          cacheWrite: val.cacheWritePerMMicroDollars !== undefined ? (val.cacheWritePerMMicroDollars / 1_000_000).toString() : "",
        };
      }
      setCustomRates(rates);

      const tools: Record<string, { costPerCall: string }> = {};
      for (const [key, val] of Object.entries(p.toolCustomRates ?? {})) {
        tools[key] = {
          costPerCall: (val.costPerCallMicroDollars / 1_000_000).toString(),
        };
      }
      setToolCustomRates(tools);
    }
  }, [pricingQuery.data]);

  const handleSave = () => {
    setSaveError(null);
    const discountBps = Math.min(10000, Math.max(0, Math.round(parseFloat(discountPercent || "0") * 100)));
    const ptuCapacityTokens = Math.max(0, Math.round(parseFloat(ptuCapacityM || "0") * 1_000_000));
    const tokenCapTokens = Math.max(0, Math.round(parseFloat(tokenCapM || "0") * 1_000_000));
    const perCallFeeMicroDollars = Math.max(0, Math.round(parseFloat(perCallFeeDollars || "0") * 1_000_000));

    const processedRates: Record<string, ModelRateOverride> = {};
    for (const [key, val] of Object.entries(customRates)) {
      if (val.input || val.output || val.cacheRead || val.cacheWrite) {
        processedRates[key] = {
          inputPerMMicroDollars: Math.round(parseFloat(val.input || "0") * 1_000_000),
          outputPerMMicroDollars: Math.round(parseFloat(val.output || "0") * 1_000_000),
          ...(val.cacheRead ? { cacheReadPerMMicroDollars: Math.round(parseFloat(val.cacheRead) * 1_000_000) } : {}),
          ...(val.cacheWrite ? { cacheWritePerMMicroDollars: Math.round(parseFloat(val.cacheWrite) * 1_000_000) } : {}),
        };
      }
    }

    const processedToolRates: Record<string, ToolRateOverride> = {};
    for (const [key, val] of Object.entries(toolCustomRates)) {
      if (val.costPerCall) {
        processedToolRates[key] = {
          costPerCallMicroDollars: Math.round(parseFloat(val.costPerCall) * 1_000_000),
        };
      }
    }

    updatePricing.mutate(
      {
        modelType,
        discountBps,
        volumeTiers,
        ptuCapacityTokens,
        tokenCapTokens,
        perCallFeeMicroDollars,
        customRates: processedRates,
        toolCustomRates: processedToolRates,
      },
      {
        onError: (err) => setSaveError(err instanceof Error ? err.message : "Failed to update pricing model."),
      },
    );
  };

  const handleRunSimulation = () => {
    const toolCalls: CalculateToolCallRequest[] = [];
    for (const [toolId, countStr] of Object.entries(simToolCounts)) {
      const count = parseInt(countStr || "0", 10);
      if (count > 0) {
        toolCalls.push({ toolId, count });
      }
    }

    calculateSpend.mutate({
      modelName: simModel,
      inputTokens: parseInt(simInputTokens || "0", 10),
      outputTokens: parseInt(simOutputTokens || "0", 10),
      cacheReadTokens: parseInt(simCacheReadTokens || "0", 10),
      cacheCreationTokens: parseInt(simCacheWriteTokens || "0", 10),
      isBatch: simIsBatch,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    });
  };

  const isEditable = canManagePricing(identity.role);
  const catalog = pricingQuery.data?.catalog ?? [];
  const toolCatalog = pricingQuery.data?.toolCatalog ?? [];
  const currentPricing = pricingQuery.data?.pricing;

  return (
    <>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>FinOps AI Provider Pricing & Rate Cards</h2>
            <p>Configure institutional rate cards, volume discount brackets, or committed PTU quota reservations per ADR 0010.</p>
          </div>
          <Badge tone="neutral">Dual-Denomination Engine</Badge>
        </div>

        {pricingQuery.isLoading ? (
          <p className="subtle">Loading active organization rate card…</p>
        ) : (
          <div className="stack" style={{ gap: "var(--space-md)" }}>
            <div className="form-grid">
              <div>
                <label className="field-label" htmlFor="model-type-select">Contract Pricing Model</label>
                <select
                  id="model-type-select"
                  value={modelType}
                  disabled={!isEditable}
                  onChange={(e) => setModelType(e.target.value as PricingModelType)}
                  style={{ width: "100%", padding: "var(--space-xs)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "transparent", color: "inherit" }}
                >
                  <option value="flat_discount">Flat Custom Discount (Rate Card Override)</option>
                  <option value="tiered_volume">Tiered Volume Ladders (Graduated Monthly Brackets)</option>
                  <option value="committed_ptu">Committed Capacity / PTUs (Sunk Reservation + Overage)</option>
                  <option value="batch_discount">Batch Inference Discount (50% Off-Peak SLA)</option>
                  <option value="per_unit_request">Per-Unit Request Toll (Base Invocations + Compute Pass-Through)</option>
                  <option value="hybrid_commit_volume">Hybrid PTU Reservation + Tiered Volume Ladders</option>
                </select>
              </div>

              {(modelType === "flat_discount" || modelType === "batch_discount") && (
                <div>
                  <TextField
                    label="Negotiated Base Discount Percentage (%)"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    disabled={!isEditable}
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(e.target.value)}
                  />
                  {modelType === "batch_discount" && (
                    <span className="subtle" style={{ fontSize: "0.8rem", display: "block", marginTop: "var(--space-2xs)" }}>
                      Guaranteed 50% discount automatically applies to all batch compute; this negotiated discount stacks additionally.
                    </span>
                  )}
                </div>
              )}

              {(modelType === "committed_ptu" || modelType === "hybrid_commit_volume") && (
                <TextField
                  label="Monthly Committed PTU Quota (Millions of Tokens)"
                  type="number"
                  min="0"
                  step="1"
                  disabled={!isEditable}
                  value={ptuCapacityM}
                  onChange={(e) => setPtuCapacityM(e.target.value)}
                />
              )}

              {modelType === "per_unit_request" && (
                <div>
                  <TextField
                    label="Fixed Per-Invocation Toll Fee ($)"
                    type="number"
                    min="0"
                    step="0.0001"
                    disabled={!isEditable}
                    value={perCallFeeDollars}
                    onChange={(e) => setPerCallFeeDollars(e.target.value)}
                  />
                  <span className="subtle" style={{ fontSize: "0.8rem", display: "block", marginTop: "var(--space-2xs)" }}>
                    Fixed toll fee billed per inference request before compute pass-through.
                  </span>
                </div>
              )}

              <div>
                <TextField
                  label="Monthly Compute Token Quota Cap (Millions of Tokens, 0 = Unlimited)"
                  type="number"
                  min="0"
                  step="1"
                  disabled={!isEditable}
                  value={tokenCapM}
                  onChange={(e) => setTokenCapM(e.target.value)}
                />
                <span className="subtle" style={{ fontSize: "0.8rem", display: "block", marginTop: "var(--space-2xs)" }}>
                  Dual-denomination hard token quota enforced in parallel with financial max spend limits.
                </span>
              </div>
            </div>

            {(modelType === "tiered_volume" || modelType === "hybrid_commit_volume") && (
              <div className="stack" style={{ gap: "var(--space-xs)", border: "1px solid var(--border)", padding: "var(--space-sm)", borderRadius: "var(--radius-md)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Volume Discount Ladders</span>
                  {isEditable && (
                    <Button
                      variant="tonal"
                      onClick={() => setVolumeTiers([...volumeTiers, { minTokens: 10_000_000, discountBps: 1500 }])}
                    >
                      + Add Tier
                    </Button>
                  )}
                </div>
                {volumeTiers.length === 0 ? (
                  <p className="subtle">No tiered brackets configured. Base rate card applies to all usage.</p>
                ) : (
                  <div className="stack" style={{ gap: "var(--space-xs)" }}>
                    {volumeTiers.map((tier, idx) => (
                      <div key={idx} style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
                        <TextField
                          label="Min Monthly Tokens"
                          type="number"
                          disabled={!isEditable}
                          value={tier.minTokens.toString()}
                          onChange={(e) => {
                            const updated = [...volumeTiers];
                            updated[idx] = { ...tier, minTokens: parseInt(e.target.value || "0", 10) };
                            setVolumeTiers(updated);
                          }}
                        />
                        <TextField
                          label="Discount (%)"
                          type="number"
                          min="0"
                          max="100"
                          disabled={!isEditable}
                          value={(tier.discountBps / 100).toString()}
                          onChange={(e) => {
                            const updated = [...volumeTiers];
                            updated[idx] = { ...tier, discountBps: Math.round(parseFloat(e.target.value || "0") * 100) };
                            setVolumeTiers(updated);
                          }}
                        />
                        {isEditable && (
                          <Button
                            variant="text"
                            onClick={() => setVolumeTiers(volumeTiers.filter((_, i) => i !== idx))}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {currentPricing && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-md)", padding: "var(--space-sm)", background: "var(--surface-muted)", borderRadius: "var(--radius-md)" }}>
                <div>
                  <span className="subtle" style={{ fontSize: "0.8rem", display: "block" }}>Monthly Tokens Metered</span>
                  <Mono>{(currentPricing.monthlyTokensConsumed).toLocaleString()} tokens</Mono>
                </div>
                <div>
                  <span className="subtle" style={{ fontSize: "0.8rem", display: "block" }}>Active Model Mode</span>
                  <Badge tone="info">{currentPricing.modelType.replace(/_/g, " ").toUpperCase()}</Badge>
                </div>
                {currentPricing.tokenCapTokens != null && currentPricing.tokenCapTokens > 0 && (
                  <div>
                    <span className="subtle" style={{ fontSize: "0.8rem", display: "block" }}>Monthly Token Quota</span>
                    <Mono>{(currentPricing.tokenCapTokens / 1_000_000).toLocaleString()}M tokens</Mono>
                  </div>
                )}
                {currentPricing.perCallFeeMicroDollars != null && currentPricing.perCallFeeMicroDollars > 0 && (
                  <div>
                    <span className="subtle" style={{ fontSize: "0.8rem", display: "block" }}>Base Invocation Fee</span>
                    <Mono>${(currentPricing.perCallFeeMicroDollars / 1_000_000).toFixed(4)}</Mono>
                  </div>
                )}
              </div>
            )}

            {isEditable && (
              <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", marginTop: "var(--space-xs)" }}>
                <Button variant="filled" onClick={handleSave} disabled={updatePricing.isPending}>
                  {updatePricing.isPending ? "Saving Rate Card…" : "Save Pricing Configuration"}
                </Button>
                {saveSuccess && <span style={{ color: "var(--success)" }}>Pricing model updated successfully.</span>}
                {saveError && <span style={{ color: "var(--destructive)" }}>{saveError}</span>}
              </div>
            )}
          </div>
        )}
      </Surface>

      <Surface>
        <div className="section-heading">
          <div>
            <h2>Official Foundation Model Catalog & Custom Overrides</h2>
            <p>Official list rates per 1M tokens in micro-dollars (USDC base units). Enter custom negotiated overrides for input, output, cache read, or cache write if applicable.</p>
          </div>
          <Badge tone="info">4-Dimension Matrix</Badge>
        </div>

        <div className="stack" style={{ gap: "var(--space-sm)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 0.8fr 0.8fr 0.9fr 0.9fr 2.6fr", gap: "var(--space-sm)", fontWeight: 600, fontSize: "0.85rem", borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-xs)" }}>
            <span>Model / Provider</span>
            <span>Input / 1M</span>
            <span>Output / 1M</span>
            <span>Cache Read</span>
            <span>Cache Write</span>
            <span>Custom Rate Overrides ($/1M: In | Out | Read | Write)</span>
          </div>
          {catalog.map((entry) => {
            const override = customRates[entry.modelId] || { input: "", output: "", cacheRead: "", cacheWrite: "" };
            return (
              <div key={entry.modelId} style={{ display: "grid", gridTemplateColumns: "1.6fr 0.8fr 0.8fr 0.9fr 0.9fr 2.6fr", gap: "var(--space-sm)", alignItems: "center", fontSize: "0.9rem" }}>
                <div>
                  <strong>{entry.displayName}</strong>
                  <span className="subtle" style={{ display: "block", fontSize: "0.75rem" }}>{entry.provider.toUpperCase()} &bull; <Mono>{entry.modelId}</Mono></span>
                </div>
                <Mono>${(entry.inputPerMMicroDollars / 1_000_000).toFixed(2)}</Mono>
                <Mono>${(entry.outputPerMMicroDollars / 1_000_000).toFixed(2)}</Mono>
                <Mono>${(entry.cacheReadPerMMicroDollars / 1_000_000).toFixed(2)}</Mono>
                <Mono>${(entry.cacheWritePerMMicroDollars / 1_000_000).toFixed(2)}</Mono>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-2xs)" }}>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="In $"
                    disabled={!isEditable}
                    value={override.input}
                    onChange={(e) => setCustomRates({ ...customRates, [entry.modelId]: { ...override, input: e.target.value } })}
                    style={{ width: "100%", padding: "4px 6px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "transparent", color: "inherit", fontSize: "0.8rem" }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Out $"
                    disabled={!isEditable}
                    value={override.output}
                    onChange={(e) => setCustomRates({ ...customRates, [entry.modelId]: { ...override, output: e.target.value } })}
                    style={{ width: "100%", padding: "4px 6px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "transparent", color: "inherit", fontSize: "0.8rem" }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Read $"
                    disabled={!isEditable}
                    value={override.cacheRead}
                    onChange={(e) => setCustomRates({ ...customRates, [entry.modelId]: { ...override, cacheRead: e.target.value } })}
                    style={{ width: "100%", padding: "4px 6px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "transparent", color: "inherit", fontSize: "0.8rem" }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Write $"
                    disabled={!isEditable}
                    value={override.cacheWrite}
                    onChange={(e) => setCustomRates({ ...customRates, [entry.modelId]: { ...override, cacheWrite: e.target.value } })}
                    style={{ width: "100%", padding: "4px 6px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "transparent", color: "inherit", fontSize: "0.8rem" }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Surface>

      <Surface>
        <div className="section-heading">
          <div>
            <h2>Per-Operation Tool & Service Rate Cards (Non-Token APIs)</h2>
            <p>Offchain agentic tools (Search, Web Scraping, Code Execution Sandboxes, Custom Webhooks) billed per call/unit rather than tokens (ADR 0010 Section 1).</p>
          </div>
          <Badge tone="neutral">Per-Operation Pricing</Badge>
        </div>

        <div className="stack" style={{ gap: "var(--space-sm)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.2fr 1.5fr", gap: "var(--space-sm)", fontWeight: 600, fontSize: "0.85rem", borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-xs)" }}>
            <span>Tool / Service & Provider</span>
            <span>Category</span>
            <span>Official Base Rate</span>
            <span>Custom Rate Override ($ / call)</span>
          </div>
          {toolCatalog.map((tool) => {
            const override = toolCustomRates[tool.toolId] || { costPerCall: "" };
            return (
              <div key={tool.toolId} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.2fr 1.5fr", gap: "var(--space-sm)", alignItems: "center", fontSize: "0.9rem" }}>
                <div>
                  <strong>{tool.displayName}</strong>
                  <span className="subtle" style={{ display: "block", fontSize: "0.75rem" }}>{tool.provider} &bull; <Mono>{tool.toolId}</Mono></span>
                </div>
                <div>
                  <Badge tone="neutral">{tool.category.toUpperCase()}</Badge>
                </div>
                <Mono>${(tool.costPerCallMicroDollars / 1_000_000).toFixed(4)} / call</Mono>
                <div>
                  <input
                    type="number"
                    step="0.0001"
                    placeholder="Override $/call"
                    disabled={!isEditable}
                    value={override.costPerCall}
                    onChange={(e) => setToolCustomRates({ ...toolCustomRates, [tool.toolId]: { costPerCall: e.target.value } })}
                    style={{ width: "100%", maxWidth: "180px", padding: "4px 8px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "transparent", color: "inherit", fontSize: "0.85rem" }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Surface>

      <Surface>
        <div className="section-heading">
          <div>
            <h2>Live Spend Simulator & FinOps Sandbox</h2>
            <p>Compute real-time dual-denomination spend under your current contract rules before running production inference workloads.</p>
          </div>
          <Badge tone="info">Pre-Flight FinOps</Badge>
        </div>

        <div className="stack" style={{ gap: "var(--space-md)" }}>
          <div className="form-grid">
            <div>
              <label className="field-label" htmlFor="sim-model-select">Target Model</label>
              <select
                id="sim-model-select"
                value={simModel}
                onChange={(e) => setSimModel(e.target.value)}
                style={{ width: "100%", padding: "var(--space-xs)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "transparent", color: "inherit" }}
              >
                {catalog.map((m) => (
                  <option key={m.modelId} value={m.modelId}>{m.displayName} ({m.modelId})</option>
                ))}
              </select>
            </div>
            <TextField
              label="Prompt Input Tokens"
              type="number"
              value={simInputTokens}
              onChange={(e) => setSimInputTokens(e.target.value)}
            />
            <TextField
              label="Completion Output Tokens"
              type="number"
              value={simOutputTokens}
              onChange={(e) => setSimOutputTokens(e.target.value)}
            />
            <TextField
              label="Cache Read Tokens"
              type="number"
              value={simCacheReadTokens}
              onChange={(e) => setSimCacheReadTokens(e.target.value)}
            />
            <TextField
              label="Cache Creation / Write Tokens"
              type="number"
              value={simCacheWriteTokens}
              onChange={(e) => setSimCacheWriteTokens(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-md)", alignItems: "center", padding: "var(--space-xs) 0" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", cursor: "pointer", fontSize: "0.9rem" }}>
              <input
                type="checkbox"
                id="sim-batch-toggle"
                checked={simIsBatch}
                onChange={(e) => setSimIsBatch(e.target.checked)}
              />
              <span style={{ fontWeight: 500 }}>Async Batch API Mode (50% Off-Peak Compute Discount)</span>
            </label>
          </div>

          {toolCatalog.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "var(--space-sm)" }}>
              <span style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: "var(--space-xs)" }}>
                Simulate Tool Invocations (Non-Token Add-ons)
              </span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-sm)" }}>
                {toolCatalog.map((tool) => (
                  <div key={tool.toolId}>
                    <TextField
                      label={`${tool.displayName} Calls`}
                      type="number"
                      min="0"
                      value={simToolCounts[tool.toolId] || "0"}
                      onChange={(e) => setSimToolCounts({ ...simToolCounts, [tool.toolId]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
            <Button variant="filled" onClick={handleRunSimulation} disabled={calculateSpend.isPending}>
              {calculateSpend.isPending ? "Calculating…" : "Calculate Spend"}
            </Button>
          </div>

          {calculateSpend.data && (
            <div style={{ padding: "var(--space-md)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface-muted)" }}>
              <h3 style={{ fontSize: "1rem", marginBottom: "var(--space-xs)" }}>Simulated Spend Evaluation Result</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--space-sm)" }}>
                <div>
                  <span className="subtle" style={{ fontSize: "0.8rem", display: "block" }}>Total Compute Tokens</span>
                  <Mono>{calculateSpend.data.totalTokens.toLocaleString()}</Mono>
                </div>
                <div>
                  <span className="subtle" style={{ fontSize: "0.8rem", display: "block" }}>Nominal List Price</span>
                  <Mono>${(calculateSpend.data.nominalListCostMicroDollars / 1_000_000).toFixed(4)}</Mono>
                </div>
                <div>
                  <span className="subtle" style={{ fontSize: "0.8rem", display: "block" }}>Effective Compute Liability (USDC)</span>
                  <Mono style={{ fontWeight: 700, color: "var(--primary)" }}>
                    ${(calculateSpend.data.effectiveCostMicroDollars / 1_000_000).toFixed(4)}
                  </Mono>
                </div>
                {calculateSpend.data.toolCostMicroDollars != null && calculateSpend.data.toolCostMicroDollars > 0 && (
                  <div>
                    <span className="subtle" style={{ fontSize: "0.8rem", display: "block" }}>Tool Execution Surcharge</span>
                    <Mono style={{ fontWeight: 600 }}>
                      ${(calculateSpend.data.toolCostMicroDollars / 1_000_000).toFixed(4)}
                    </Mono>
                  </div>
                )}
                {calculateSpend.data.toolCostMicroDollars != null && calculateSpend.data.toolCostMicroDollars > 0 && (
                  <div>
                    <span className="subtle" style={{ fontSize: "0.8rem", display: "block" }}>Total Gross Liability</span>
                    <Mono style={{ fontWeight: 700, color: "var(--primary)" }}>
                      ${((calculateSpend.data.effectiveCostMicroDollars + calculateSpend.data.toolCostMicroDollars) / 1_000_000).toFixed(4)}
                    </Mono>
                  </div>
                )}
                <div>
                  <span className="subtle" style={{ fontSize: "0.8rem", display: "block" }}>Effective Discount</span>
                  <Badge tone={calculateSpend.data.effectiveDiscountBps > 0 ? "success" : "neutral"}>
                    {(calculateSpend.data.effectiveDiscountBps / 100).toFixed(1)}% OFF
                  </Badge>
                </div>
                {calculateSpend.data.contractModel === "committed_ptu" && (
                  <div>
                    <span className="subtle" style={{ fontSize: "0.8rem", display: "block" }}>PTU Absorption</span>
                    <Mono>{calculateSpend.data.ptuCapacityApplied.toLocaleString()} tokens ($0 marginal)</Mono>
                  </div>
                )}
                {calculateSpend.data.contractModel === "hybrid_commit_volume" && (
                  <div>
                    <span className="subtle" style={{ fontSize: "0.8rem", display: "block" }}>Hybrid PTU Applied</span>
                    <Mono>{calculateSpend.data.ptuCapacityApplied.toLocaleString()} tokens absorbed</Mono>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Surface>
    </>
  );
}
