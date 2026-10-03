import { useState } from "react";
import { toUserFacingError, usePlatformOperators, useUpsertPlatformOperator } from "../../api";
import { Badge, Button, EmptyState, Mono, Select, Surface, TextField, formatPlatformRole } from "../../design-system";
import { useIdentity } from "../../identity";

const platformRoles = [
  "platform_super_admin",
  "platform_operations",
  "platform_security",
  "platform_billing",
  "platform_support",
  "platform_auditor",
  "platform_viewer",
] as const;

export function AdminAccess() {
  const identity = useIdentity();
  const operators = usePlatformOperators(identity.platformAccess);
  const [subject, setSubject] = useState("");
  const [role, setRole] = useState<(typeof platformRoles)[number]>("platform_viewer");
  const [message, setMessage] = useState("");
  const upsert = useUpsertPlatformOperator(() => {
    setSubject("");
    setMessage("Platform access updated.");
    void operators.refetch();
  });
  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <h1>Team</h1>
          <p>Choose who can manage the platform and what they can do.</p>
        </div>
      </header>
      <Surface>
        <div className="section-heading">
          <h2>Add team member</h2>
        </div>
        <div className="inline-form">
          <TextField label="Account ID" value={subject} onChange={(event) => setSubject(event.target.value)} />
          <Select
            label="Role"
            value={role}
            onChange={(val) => setRole(val as (typeof platformRoles)[number])}
            options={platformRoles.map((item) => ({
              value: item,
              label: formatPlatformRole(item),
            }))}
          />
          <Button
            onClick={() => {
              setMessage("");
              upsert.mutate(
                { subject, role },
                {
                  onError: (error) =>
                    setMessage(toUserFacingError(error, "The platform role could not be updated.")),
                },
              );
            }}
            disabled={!subject.trim() || upsert.isPending}
          >
            {upsert.isPending ? "Saving…" : "Save access"}
          </Button>
        </div>
        {message && <p className="form-message">{message}</p>}
      </Surface>
      <Surface>
        <div className="section-heading">
          <h2>Team ({operators.data?.length ?? 0})</h2>
        </div>
        {operators.isError ? (
          <EmptyState title="Couldn't load team" detail="Try refreshing the page." />
        ) : operators.data?.length ? (
          <div className="entity-list">
            {operators.data.map((operator) => (
              <div className="entity-row" key={operator.subject}>
                <strong><Mono>{operator.subject}</Mono></strong>
                <Badge tone="info">{formatPlatformRole(operator.role)}</Badge>
                <Badge tone={operator.status === "active" ? "success" : "neutral"}>{operator.status}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No team members yet" detail="Add your first team member above." />
        )}
      </Surface>
    </div>
  );
}
