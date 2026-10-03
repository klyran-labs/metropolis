import { useEffect, useState } from "react";
import { type AbacPolicy, type PbacPolicy, useAbacPolicy, useDeactivatePbacPolicy, usePbacPolicies, usePutAbacPolicy, useUpsertPbacPolicy, toUserFacingError } from "../../../api";
import { Badge, Button, Dialog, EmptyState, Mono, Select, Surface, Switch, TextField, SkeletonRows } from "../../../design-system";
import { type Identity } from "../../../identity";
import { ASSIGNABLE_CAPABILITIES, capabilityLabel, canManageSecurity } from "./shared";

export function PolicyTab({ identity }: { identity: Identity }) {
  const canManage = canManageSecurity(identity.role);
  const policies = usePbacPolicies(canManage);
  const abac = useAbacPolicy(canManage);

  const [pbacDialogOpen, setPbacDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<PbacPolicy | null>(null);
  const [pbacError, setPbacError] = useState("");
  const [effect, setEffect] = useState<"allow" | "deny">("allow");
  const [principals, setPrincipals] = useState("*");
  const [selectedActions, setSelectedActions] = useState<string[]>([]);
  const [customActions, setCustomActions] = useState("");
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
    setSelectedActions([]);
    setCustomActions("");
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
    setPrincipals(policy.principals.join(", ") || "*");
    const known = new Set<string>(ASSIGNABLE_CAPABILITIES.map((c) => c.value));
    setSelectedActions(policy.actions.filter((a) => known.has(a)));
    setCustomActions(policy.actions.filter((a) => !known.has(a)).join(", "));
    setResources(policy.resources.join(", ") || "*");
    setMaxAmount(policy.conditions.maxAmount ? (Number(policy.conditions.maxAmount) / 1_000_000).toString() : "");
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
        <EmptyState kind="rules"
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
            <p>Control who can do what. If a rule blocks something, that always wins.</p>
          </div>
          <Button onClick={openCreateRule}>New rule</Button>
        </div>
        {policies.isError ? (
          <EmptyState kind="warning" title="Access rules unavailable" detail="We couldn't load your access rules right now." />
        ) : policies.data?.length ? (
          <div className="entity-list">
            {policies.data.map((policy) => {
              const who = policy.principals.join(", ") || "*";
              const what = policy.actions.length
                ? policy.actions.map((a) => capabilityLabel(a)).join(", ")
                : "everything";
              const where = policy.resources.join(", ") || "*";
              return (
                <div className="entity-row" key={policy.id}>
                  <Badge tone={policy.effect === "deny" ? "critical" : "success"}>
                    {policy.effect === "deny" ? "Blocks" : "Allows"}
                  </Badge>
                  <span>
                    <strong>{who === "*" ? "Everyone" : who}</strong> can {policy.effect === "deny" ? "not " : ""}
                    {what}
                    {where !== "*" && <> on <Mono>{where}</Mono></>}
                  </span>
                  <small>v{policy.version}</small>
                  <Button variant="text" onClick={() => openReviseRule(policy)}>Revise</Button>
                  <Button variant="text" onClick={() => deactivatePolicy.mutate(policy.id)} disabled={deactivatePolicy.isPending}>
                    Retire
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState kind="rules" title="No rules yet" detail="Create your first access rule above." />
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
          <EmptyState kind="warning" title="Organization controls unavailable" detail="We couldn't load organization controls right now." />
        ) : abacForm ? (
          <div className="settings-form-grid">
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
                    setAbacError(toUserFacingError(error, "Organization controls could not be saved.")),
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
          <SkeletonRows rows={3} label="Loading organization controls" />
        )}
      </Surface>

      <Dialog
        open={pbacDialogOpen}
        onClose={() => setPbacDialogOpen(false)}
        title={editingPolicy ? "Revise access rule" : "New access rule"}
        description="Choose who this applies to and what they're allowed — or blocked from — doing."
        footer={
          <>
            <Button variant="text" onClick={() => setPbacDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                setPbacError("");
                const actions = [...selectedActions, ...customActions.split(",").map((v) => v.trim()).filter(Boolean)];
                if (actions.length === 0) return setPbacError("Choose at least one action.");
                upsertPolicy.mutate(
                  {
                    id: editingPolicy?.id,
                    effect,
                    principals: principals.split(",").map((value) => value.trim()).filter(Boolean),
                    actions,
                    resources: resources.split(",").map((value) => value.trim()).filter(Boolean),
                    conditions: {
                      maxAmount: maxAmount.trim() ? (isNaN(Number(maxAmount)) ? maxAmount.trim() : Math.round(parseFloat(maxAmount) * 1_000_000).toString()) : null,
                      requiredMultisigSignatures: requiredSignatures.trim() ? Number(requiredSignatures) : null,
                      requireMfa: requireMfa || null,
                      eligibleApproverRoles: [],
                    },
                  },
                  { onError: (error) => setPbacError(toUserFacingError(error, "The access rule could not be saved.")) },
                );
              }}
              disabled={upsertPolicy.isPending}
            >
              {upsertPolicy.isPending ? "Saving…" : "Save rule"}
            </Button>
          </>
        }
      >
        <div className="dialog-form-stack">
          <Select
            label="This rule"
            value={effect}
            onChange={(val) => setEffect(val as "allow" | "deny")}
            options={[
              { value: "allow", label: "Allows", detail: "Let matching requests through" },
              { value: "deny", label: "Blocks", detail: "Stop matching requests immediately" },
            ]}
          />

          <div className="field-group-label">Who this applies to</div>
          <Switch
            checked={principals.trim() === "*" || principals.trim() === ""}
            onChange={(on) => setPrincipals(on ? "*" : "")}
            label="Everyone"
            description="Turn off to name specific people"
          />
          {!(principals.trim() === "*" || principals.trim() === "") && (
            <TextField
              label="Operator names (comma-separated)"
              value={principals}
              onChange={(event) => setPrincipals(event.target.value)}
            />
          )}

          <div className="field-group-label">What they can do</div>
          <div className="capability-checkboxes">
            {ASSIGNABLE_CAPABILITIES.map((capability) => (
              <label key={capability.value}>
                <input
                  type="checkbox"
                  checked={selectedActions.includes(capability.value)}
                  onChange={(event) =>
                    setSelectedActions((current) =>
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
          <TextField
            label="Other actions (advanced, comma-separated)"
            value={customActions}
            onChange={(event) => setCustomActions(event.target.value)}
          />

          <div className="field-group-label">Where it applies</div>
          <Switch
            checked={resources.trim() === "*" || resources.trim() === ""}
            onChange={(on) => setResources(on ? "*" : "")}
            label="Everywhere"
            description="Turn off to name specific resources"
          />
          {!(resources.trim() === "*" || resources.trim() === "") && (
            <TextField
              label="Resource IDs (comma-separated)"
              value={resources}
              onChange={(event) => setResources(event.target.value)}
            />
          )}

          <TextField label="Spending limit ($, optional)" placeholder="0.00" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} />
          <TextField
            label="Approvals needed (optional)"
            type="number"
            min={1}
            value={requiredSignatures}
            onChange={(event) => setRequiredSignatures(event.target.value)}
          />
          <label className="check-field">
            <input type="checkbox" checked={requireMfa} onChange={(event) => setRequireMfa(event.target.checked)} />
            Require extra verification (MFA)
          </label>
          {pbacError && <p className="form-message">{pbacError}</p>}
        </div>
      </Dialog>
    </div>
  );
}

