import { useState } from "react";
import {
  Sparkles,
  X,
  Send,
  ShieldAlert,
  CheckCircle2,
  HelpCircle,
  ArrowRight,
  Sliders,
  Terminal,
} from "lucide-react";
import { Badge, Button, Mono, TextField } from "../design-system";

export function AICopilot({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [activeTab, setActiveTab] = useState<"compiler" | "diagnostics">("compiler");
  const [compiledResult, setCompiledResult] = useState<{
    maxPerTx: number;
    hourlyVelocity: number;
    selectedTier: string;
    explanation: string;
  } | null>(null);
  const [applied, setApplied] = useState(false);
  const [selectedReasonCode, setSelectedReasonCode] = useState<number | null>(null);

  if (!open) return null;

  const handleCompile = () => {
    if (!prompt.trim()) return;
    setApplied(false);
    // Parse user prompt keywords to configure policy parameters deterministically
    const lower = prompt.toLowerCase();
    let maxTx = 50;
    let velocity = 500;
    let tier = "tier2_standard";

    const txMatch = lower.match(/(\d+)\s*(usdc|dollars|\$)/);
    if (txMatch) {
      maxTx = parseInt(txMatch[1], 10);
    }
    const velMatch = lower.match(/(\d+)\s*(hourly|velocity|per hour)/);
    if (velMatch) {
      velocity = parseInt(velMatch[1], 10);
    }
    if (lower.includes("strict") || lower.includes("conservative") || lower.includes("low")) {
      tier = "tier1_conservative";
    } else if (lower.includes("high") || lower.includes("autonomous")) {
      tier = "tier3_autonomous";
    }

    setCompiledResult({
      maxPerTx: maxTx,
      hourlyVelocity: velocity,
      selectedTier: tier,
      explanation: `Synthesized policy: Limit each autonomous spend action to ${maxTx} USDC with an hourly sliding window ceiling of ${velocity} USDC under ${tier}.`,
    });
  };

  const reasonCodeDescriptions: Record<number, { code: string; title: string; desc: string }> = {
    1: {
      code: "ERR_MAX_PER_TX",
      title: "Per-Transaction Limit Exceeded",
      desc: "The transaction amount requested exceeds the maxSpendPerTx slot configured in the agent's PackedPolicy.",
    },
    2: {
      code: "ERR_TOTAL_LIMIT",
      title: "Lifetime Limit Exceeded",
      desc: "Total cumulative spend has surpassed the hard lifetime maximum budget allocated to this agent.",
    },
    3: {
      code: "ERR_VELOCITY_EXCEEDED",
      title: "Hourly Velocity Window Saturated",
      desc: "The cumulative expenditure within the active sliding epoch window exceeded maxVelocityCeiling.",
    },
    4: {
      code: "ERR_MERCHANT_NOT_ALLOWED",
      title: "Merchant Not Whitelisted",
      desc: "The destination recipient address is not authorized in the merchant whitelist mapping.",
    },
    5: {
      code: "ERR_KILL_SWITCH",
      title: "Circuit Breaker Tripped",
      desc: "Emergency halt active. The O(1) kill-switch bit is set to true for this agent address.",
    },
    6: {
      code: "ERR_BUDGET_EXHAUSTED",
      title: "Budget Pool Depleted",
      desc: "The shared organizational budget pool assigned to this agent has zero remaining unallocated balance.",
    },
    7: {
      code: "ERR_REPUTATION_TOO_LOW",
      title: "Reputation Threshold Breach",
      desc: "Agent's EWMA trust score in ReputationRegistry has fallen below minReputationScore.",
    },
    8: {
      code: "ERR_CALLDATA_FORBIDDEN",
      title: "Forbidden Calldata Signature",
      desc: "Calldata payload contains a method selector explicitly blocked by PBAC risk policy rules.",
    },
    9: {
      code: "ERR_SIGNATURE_INVALID",
      title: "Cryptographic Signature Invalid",
      desc: "EIP-712 signature verification failed against the recovered signer address or nonce was reused.",
    },
  };

  return (
    <div className="copilot-backdrop" onClick={onClose}>
      <aside className="copilot-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="copilot-header">
          <div className="copilot-title">
            <Sparkles size={18} className="copilot-sparkle-icon" />
            <div>
              <h3>AI Risk Copilot</h3>
              <small>Autonomous policy synthesis & failure diagnostics</small>
            </div>
          </div>
          <button type="button" className="copilot-close-btn" onClick={onClose} aria-label="Close copilot">
            <X size={18} />
          </button>
        </header>

        <div className="copilot-tabs">
          <button
            type="button"
            className={`copilot-tab ${activeTab === "compiler" ? "active" : ""}`}
            onClick={() => setActiveTab("compiler")}
          >
            <Sliders size={14} />
            Policy Compiler
          </button>
          <button
            type="button"
            className={`copilot-tab ${activeTab === "diagnostics" ? "active" : ""}`}
            onClick={() => setActiveTab("diagnostics")}
          >
            <ShieldAlert size={14} />
            Reason Diagnostics
          </button>
        </div>

        <div className="copilot-content">
          {activeTab === "compiler" ? (
            <div className="copilot-compiler-view">
              <p className="copilot-intro">
                Describe desired spending guardrails in plain English. The compiler synthesizes onchain policy parameters with live interactive controls.
              </p>

              <div className="copilot-presets">
                <span className="copilot-preset-label">Suggested prompts:</span>
                <button
                  type="button"
                  className="copilot-preset-chip"
                  onClick={() => {
                    setPrompt("Cap transaction at 75 USDC with 300 USDC hourly limit under conservative tier");
                  }}
                >
                  "Cap at 75 USDC with 300 USDC hourly limit"
                </button>
                <button
                  type="button"
                  className="copilot-preset-chip"
                  onClick={() => {
                    setPrompt("Strict defense mode: max 25 USDC per transaction for newly deployed agents");
                  }}
                >
                  "Strict defense: max 25 USDC for new agents"
                </button>
              </div>

              <div className="copilot-input-row">
                <input
                  type="text"
                  className="copilot-input"
                  placeholder="e.g. Set maximum 100 USDC per tx and 1000 USDC hourly velocity..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCompile();
                  }}
                />
                <button
                  type="button"
                  className="copilot-submit-btn"
                  onClick={handleCompile}
                  disabled={!prompt.trim()}
                >
                  <Send size={15} />
                </button>
              </div>

              {compiledResult && (
                <div className="copilot-widget-card">
                  <div className="widget-header">
                    <span className="widget-badge">
                      <Sparkles size={12} /> Synthesized Policy Widget
                    </span>
                    <Badge tone="info">{compiledResult.selectedTier}</Badge>
                  </div>
                  <p className="widget-explanation">{compiledResult.explanation}</p>

                  <div className="widget-controls">
                    <div className="widget-slider-group">
                      <div className="widget-slider-label">
                        <span>Max per Transaction</span>
                        <strong>{compiledResult.maxPerTx} USDC</strong>
                      </div>
                      <input
                        type="range"
                        min="5"
                        max="500"
                        step="5"
                        value={compiledResult.maxPerTx}
                        onChange={(e) =>
                          setCompiledResult({
                            ...compiledResult,
                            maxPerTx: parseInt(e.target.value, 10),
                          })
                        }
                      />
                    </div>

                    <div className="widget-slider-group">
                      <div className="widget-slider-label">
                        <span>Hourly Velocity Ceiling</span>
                        <strong>{compiledResult.hourlyVelocity} USDC</strong>
                      </div>
                      <input
                        type="range"
                        min="50"
                        max="5000"
                        step="50"
                        value={compiledResult.hourlyVelocity}
                        onChange={(e) =>
                          setCompiledResult({
                            ...compiledResult,
                            hourlyVelocity: parseInt(e.target.value, 10),
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="widget-actions">
                    <Button
                      onClick={() => setApplied(true)}
                      disabled={applied}
                    >
                      {applied ? (
                        <>
                          <CheckCircle2 size={15} /> Rule Staged for Policy Engine
                        </>
                      ) : (
                        <>
                          Apply Configuration <ArrowRight size={15} />
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="copilot-diagnostics-view">
              <p className="copilot-intro">
                Select an onchain ReasonCode to inspect its invariant trigger condition and operational remediation steps.
              </p>

              <div className="reason-code-list">
                {Object.entries(reasonCodeDescriptions).map(([codeStr, item]) => {
                  const code = parseInt(codeStr, 10);
                  const isSelected = selectedReasonCode === code;
                  return (
                    <div
                      key={code}
                      className={`reason-code-item ${isSelected ? "selected" : ""}`}
                      onClick={() => setSelectedReasonCode(isSelected ? null : code)}
                    >
                      <div className="reason-code-header">
                        <span className="reason-code-pill">Code {code}</span>
                        <strong>{item.code}</strong>
                      </div>
                      <p className="reason-code-title">{item.title}</p>
                      {isSelected && (
                        <div className="reason-code-detail">
                          <p>{item.desc}</p>
                          <div className="remediation-box">
                            <strong>Remediation:</strong>
                            <small>
                              Adjust spending limits in Policy Studio, replenish the treasury wallet, or clear the circuit breaker freeze.
                            </small>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
