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
import { ONCHAIN_REASON_CODES } from "../hooks/usePolicyContracts";

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
              <div className="copilot-input-box">
                <textarea
                  className="copilot-textarea"
                  placeholder="Describe your agent workload (e.g., 'Autonomous scraping bot making up to $25 payments per call, max $300/hr, strict merchant whitelist')..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                />
                <div className="copilot-input-footer">
                  <div className="copilot-chips">
                    <button
                      type="button"
                      className="prompt-chip"
                      onClick={() =>
                        setPrompt(
                          "Autonomous LLM agent making up to $10 micro-inference calls, max $100 per hour.",
                        )
                      }
                    >
                      Micro Inference
                    </button>
                    <button
                      type="button"
                      className="prompt-chip"
                      onClick={() =>
                        setPrompt(
                          "High-cadence trading agent executing up to $250 rebalancing swaps, max $2000 per hour with strict whitelist.",
                        )
                      }
                    >
                      DeFi Rebalancer
                    </button>
                  </div>
                  <Button
                    variant="filled"
                    onClick={handleCompile}
                    disabled={!prompt.trim()}
                  >
                    <Sparkles size={14} />
                    <span>Compile Policy</span>
                  </Button>
                </div>
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
                {Object.entries(ONCHAIN_REASON_CODES).map(([codeStr, item]) => {
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
                            <small>{item.remediation}</small>
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
