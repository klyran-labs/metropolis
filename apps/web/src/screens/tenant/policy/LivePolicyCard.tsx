import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useAgentPolicy } from "../../../api";
import { Badge, EmptyState, Mono, Surface } from "../../../design-system";
import { formatWindowEpoch } from "./utils";
import { formatBaseUnits } from "../../../format";

export function LivePolicyCard({ policy }: { policy: ReturnType<typeof useAgentPolicy> }) {
  return (
    <div className="policy-state-column">
      <Surface className="policy-preview-card">
        <div className="preview-card-header">
          <div>
            <h3>Current spending rules</h3>
            <p>What's live right now</p>
          </div>
          <span className="live-status-pill">
            <span className="status-dot dot-success" />
            Live
          </span>
        </div>

        {policy.isError ? (
          <EmptyState kind="warning" title="Policy unavailable" detail="We couldn't load this agent's spending rules." />
        ) : policy.data ? (
          <div className="policy-live-summary">
            <div className="live-summary-row">
              <span className="summary-row-label">Per transaction</span>
              <Mono className="summary-row-val">
                {formatBaseUnits((policy.data.maxPerTx ?? 0) as string | number)} USDC
              </Mono>
            </div>

            <div className="live-summary-row">
              <span className="summary-row-label">Per period</span>
              <Mono className="summary-row-val">
                {formatBaseUnits((policy.data.maxPerWindow ?? 0) as string | number)} USDC
              </Mono>
            </div>

            <div className="live-summary-row">
              <span className="summary-row-label">Period length</span>
              <Mono className="summary-row-val">
                {formatWindowEpoch(Number(policy.data.windowSeconds ?? 3600))}
              </Mono>
            </div>

            <div className="live-summary-row">
              <span className="summary-row-label">Max payments per period</span>
              <Mono className="summary-row-val">{String(policy.data.maxVelocity ?? 1)} txs</Mono>
            </div>

            <div className="live-summary-divider" />

            <div className="live-summary-row">
              <span className="summary-row-label">Spending</span>
              <Badge tone={policy.data.killSwitch ? "critical" : "success"}>
                {policy.data.killSwitch ? "Paused" : "Active"}
              </Badge>
            </div>

            <div className="live-summary-row">
              <span className="summary-row-label">Approved merchants</span>
              <Badge tone={policy.data.whitelistEnabled ? "info" : "neutral"}>
                {policy.data.whitelistEnabled ? "Required" : "Not required"}
              </Badge>
            </div>

            <div className="live-summary-footer">
              <Link to="/app/simulator" className="live-summary-sim-link">
                <span>Test limits in Simulator</span>
                <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        ) : (
          <EmptyState
            kind="agents"
            title="No agent selected"
            detail="Choose an agent to view and update its spending limits."
          />
        )}
      </Surface>
    </div>
  );
}
