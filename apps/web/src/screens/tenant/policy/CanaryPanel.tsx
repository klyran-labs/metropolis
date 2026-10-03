import { AlertOctagon, Scale, Gauge, RotateCcw, TrendingUp } from "lucide-react";
import { type CanaryDeployment } from "../../../api";
import { Badge, Button } from "../../../design-system";
export function CanaryPanel({ deployment, isPublishing, canStage, onInit, onAdvance, onRollback, onCancel }: {
  deployment: CanaryDeployment | null;
  isPublishing: boolean;
  canStage: boolean;
  onInit: () => void;
  onAdvance: () => void;
  onRollback: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="policy-canary-section">
      <div className="policy-canary-header">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Gauge size={18} />
          <span style={{ fontWeight: 700, fontSize: "0.92rem" }}>Gradual rollout</span>
        </div>
        {deployment ? (
          <Badge tone={deployment.stage === "rolled_back" ? "critical" : deployment.stage === "promoted_100" ? "success" : "warning"}>
            {deployment.trafficPct}% of traffic
          </Badge>
        ) : (
          <Badge tone="neutral">Not started</Badge>
        )}
      </div>

      <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
        Roll out this change to a small share of traffic first, then expand once you're confident it's safe. If something looks wrong, roll back instantly.
      </p>

      {deployment ? (
        <div className="canary-active-card">
          {/* 5-Stage Visual Stepper */}
          <div className="canary-stepper" role="group" aria-label="Canary Rollout Stages">
            {[
              { key: "staged", label: "0% Staged", pct: 0 },
              { key: "canary_10", label: "10% Pilot", pct: 10 },
              { key: "canary_25", label: "25% Scale", pct: 25 },
              { key: "canary_50", label: "50% Trial", pct: 50 },
              { key: "promoted_100", label: "100% Consensus", pct: 100 },
            ].map((step, idx) => {
              const isPassed = deployment.trafficPct >= step.pct;
              const isCurrent = deployment.stage === step.key;
              return (
                <div
                  key={step.key}
                  className={`canary-step-pill ${isPassed ? "step-passed" : ""} ${isCurrent ? "step-current" : ""}`}
                >
                  <div className="step-badge">{idx}</div>
                  <div className="step-text">
                    <strong>{step.label}</strong>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Live Breaker Telemetry */}
          <div className="canary-metrics-row">
            <div className="canary-metric-box">
              <small className="muted-label">Problem rate</small>
              <strong style={{ color: deployment.observedBreachRatePct > deployment.anomalyThresholdPct ? "var(--error)" : "var(--status-good)" }}>
                {deployment.observedBreachRatePct.toFixed(1)}%
              </strong>
            </div>
            <div className="canary-metric-box">
              <small className="muted-label">Safety threshold</small>
              <strong>{deployment.anomalyThresholdPct.toFixed(1)}%</strong>
            </div>
            <div className="canary-metric-box">
              <small className="muted-label">Traffic on new rules</small>
              <strong>{deployment.trafficPct}%</strong>
            </div>
          </div>

          {/* Safety Alert if Breached */}
          {deployment.observedBreachRatePct > deployment.anomalyThresholdPct && (
            <div className="canary-breach-alert">
              <AlertOctagon size={18} />
              <div>
                <strong>Unusual activity detected</strong>
                <p style={{ margin: 0, fontSize: "0.78rem" }}>
                  The problem rate ({deployment.observedBreachRatePct}%) is above the safety threshold ({deployment.anomalyThresholdPct}%). Rolling back is recommended.
                </p>
              </div>
            </div>
          )}

          {/* Canary Action Bar */}
          <div className="canary-actions-bar">
            {deployment.stage !== "promoted_100" && deployment.stage !== "rolled_back" && (
              <Button
                variant="filled"
                onClick={onAdvance}
                disabled={isPublishing}
              >
                <TrendingUp size={14} style={{ marginRight: 6 }} />
                <span>
                  {deployment.stage === "staged"
                    ? "Start with 10% of traffic"
                    : deployment.stage === "canary_10"
                      ? "Move to 25%"
                      : deployment.stage === "canary_25"
                        ? "Move to 50%"
                        : "Roll out to everyone"}
                </span>
              </Button>
            )}

            <Button
              variant="filled"
              className="control-critical"
              onClick={onRollback}
              disabled={isPublishing}
              title="Instantly restore the previous settings"
            >
              <RotateCcw size={14} style={{ marginRight: 6 }} />
              <span>{isPublishing ? "Rolling back…" : "Roll back now"}</span>
            </Button>

            <Button
              variant="tonal"
              onClick={onCancel}
              disabled={isPublishing}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="canary-idle-banner">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
            <span style={{ fontSize: "0.82rem", color: "var(--on-surface-secondary)" }}>
              Roll this change out gradually instead of publishing it to everyone at once.
            </span>
            <Button
              variant="tonal"
              onClick={onInit}
              disabled={!canStage}
            >
              <Gauge size={14} style={{ marginRight: 6 }} />
              <span>Start gradual rollout (10%)</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
