import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useAgents, useTenantOperators } from "../../../api";
import { Badge, EmptyState, Mono, Surface, roleLabel } from "../../../design-system";
import { type Identity } from "../../../identity";

export function TeamTab({ identity }: { identity: Identity }) {
  const operators = useTenantOperators(Boolean(identity.authenticated));
  const agents = useAgents(Boolean(identity.authenticated));
  const managedWallets = (agents.data ?? []).filter((agent) => agent.walletSource === "sovereign");
  return (
    <>
      <Surface>
        <div className="section-heading">
          <h2>Team Access</h2>
          <Badge tone="info">{roleLabel(identity.role)}</Badge>
        </div>
        {operators.isError ? (
          <EmptyState
            kind="rules"
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
            kind="neutral"
            title="No other teammates yet"
            detail="Ask an administrator to add more people to this organization."
          />
        )}
      </Surface>
      <Surface>
        <div className="section-heading">
          <h2>Agent Wallets</h2>
          <Link to="/app/fleet" className="control control-text">
            Register an agent
            <ArrowRight size={14} />
          </Link>
        </div>
        {agents.isError ? (
          <EmptyState kind="warning" title="Wallets unavailable" detail="We couldn't load your agent wallets right now." />
        ) : managedWallets.length ? (
          <div className="entity-list">
            {managedWallets.map((agent) => (
              <div className="entity-row" key={agent.address}>
                <strong><Mono>{agent.address}</Mono></strong>
                <Badge tone="neutral">{agent.environment}</Badge>
                <Badge tone="success">Secure</Badge>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            kind="wallet"
            title="No managed wallets yet"
            detail="Register an agent with an auto-generated wallet in Fleet to see it here."
          />
        )}
      </Surface>
    </>
  );
}

