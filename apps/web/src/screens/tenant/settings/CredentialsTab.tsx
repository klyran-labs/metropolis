import { useState } from "react";
import { type ApiKey, type IssuedApiKey, useAgents, useApiKeys, useCreateApiKey, useRevokeApiKey, useRotateApiKey, toUserFacingError } from "../../../api";
import { AgentSelect, Badge, Button, Dialog, EmptyState, Mono, Select, Surface, TextField, truncateMiddle } from "../../../design-system";
import { type Identity } from "../../../identity";
import { ASSIGNABLE_CAPABILITIES, canManageSecurity, defaultExpiryInput } from "./shared";

function credentialStatus(key: ApiKey): { label: string; tone: "success" | "warning" | "neutral" } {
  if (key.revokedAt) return { label: "Revoked", tone: "neutral" };
  if (key.expiresAt && new Date(key.expiresAt) <= new Date()) return { label: "Expired", tone: "warning" };
  return { label: "Active", tone: "success" };
}

export function CredentialsTab({ identity }: { identity: Identity }) {
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
        <EmptyState kind="rules"
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
        <EmptyState kind="warning" title="Credentials unavailable" detail="We couldn't load machine credentials right now." />
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
        <EmptyState kind="credentials" title="No credentials yet" detail="Issue a scoped credential for an agent's automation above." />
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
                    { onError: (error) => setFormError(toUserFacingError(error, "The credential could not be issued.")) },
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
          <div className="dialog-form-stack">
            <AgentSelect
              label="Associated Agent"
              placeholder="Select an agent..."
              value={agentAddress}
              agents={agents.data ?? []}
              onChange={(val) => setAgentAddress(val)}
            />
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
                    { onError: (error) => setFormError(toUserFacingError(error, "The credential could not be rotated.")) },
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
          <div className="dialog-form-stack">
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

