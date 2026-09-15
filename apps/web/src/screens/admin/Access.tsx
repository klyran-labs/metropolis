import { useState } from "react";
import { usePlatformOperators, useUpsertPlatformOperator } from "../../api";
import { Badge, Button, EmptyState, Mono, Surface, TextField } from "../../design-system";
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
          <span className="eyebrow">Admin / Access</span>
          <h1>Platform access</h1>
          <p>Grant or update platform-level roles, separate from tenant membership.</p>
        </div>
      </header>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Assign a platform role</h2>
            <p>Roles are evaluated independently from the six tenant roles.</p>
          </div>
        </div>
        <div className="inline-form">
          <TextField label="Identity subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
          <select aria-label="Platform role" value={role} onChange={(event) => setRole(event.target.value as (typeof platformRoles)[number])}>
            {platformRoles.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <Button
            onClick={() => {
              setMessage("");
              upsert.mutate(
                { subject, role },
                {
                  onError: (error) =>
                    setMessage(error instanceof Error ? error.message : "The platform role could not be updated."),
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
          <div>
            <h2>Platform operators</h2>
            <p>{operators.data?.length ?? 0} identities hold a platform role.</p>
          </div>
        </div>
        {operators.isError ? (
          <EmptyState title="Access directory unavailable" detail="We couldn't load platform operators right now." />
        ) : operators.data?.length ? (
          <div className="entity-list">
            {operators.data.map((operator) => (
              <div className="entity-row" key={operator.subject}>
                <strong><Mono>{operator.subject}</Mono></strong>
                <Badge tone="info">{operator.role}</Badge>
                <Badge tone={operator.status === "active" ? "success" : "neutral"}>{operator.status}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No platform operators" detail="Assign the first platform role above." />
        )}
      </Surface>
    </div>
  );
}
