import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import {
  type AbacPolicy,
  type ApiKey,
  type IssuedApiKey,
  type PbacPolicy,
  useAbacPolicy,
  useAgents,
  useApiKeys,
  useCreateApiKey,
  useDeactivatePbacPolicy,
  usePbacPolicies,
  usePutAbacPolicy,
  useRevokeApiKey,
  useRotateApiKey,
  useTenantOperators,
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

type SettingsTab = "team" | "credentials" | "policy";
const TAB_LABEL: Record<SettingsTab, string> = { team: "Team", credentials: "Credentials", policy: "Policy" };

export function Settings() {
  const identity = useIdentity();
  const [tab, setTab] = useState<SettingsTab>("team");
  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Home / Settings</span>
          <h1>Settings</h1>
          <p>Manage who's on your team, what they can do, and how your agent wallets are secured.</p>
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
