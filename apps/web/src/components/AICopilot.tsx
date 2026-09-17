import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
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
  AlertTriangle,
} from "lucide-react";
import { useCompilePolicy, type CompiledPolicyResult } from "../api";
import { Badge, Button, Mono, TextField } from "../design-system";
import { ONCHAIN_REASON_CODES } from "../hooks/usePolicyContracts";

export function AICopilot({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const compilePolicy = useCompilePolicy();
  const [prompt, setPrompt] = useState("");
  const [activeTab, setActiveTab] = useState<"compiler" | "diagnostics">("compiler");
  const [compiledResult, setCompiledResult] = useState<CompiledPolicyResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [selectedReasonCode, setSelectedReasonCode] = useState<number | null>(null);

  if (!open) return null;

  const handleCompile = () => {
    if (!prompt.trim()) return;
    setApplied(false);
    compilePolicy.mutate(
      { prompt },
      {
        onSuccess: (data) => {
          setCompiledResult(data);
        },
      },
    );
  };

  const handleApplyToPolicyStudio = () => {
    if (!compiledResult) return;
    try {
      sessionStorage.setItem(
        "agentguard_staged_policy",
        JSON.stringify({
          maxPerTx: compiledResult.maxPerTx,
          maxPerWindow: compiledResult.maxPerWindow,
          windowSeconds: compiledResult.windowSeconds,
          maxVelocity: compiledResult.maxVelocity,
          whitelistEnabled: compiledResult.whitelistEnabled,
        }),
      );
      setApplied(true);
      setTimeout(() => {
        onClose();
        void navigate({ to: "/app/policy" });
      }, 400);
    } catch {
      setApplied(true);
    }
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
                      <Sparkles size={12} /> Synthesized Policy (Alibaba Qwen 3.8 Max)
                    </span>
                    <Badge tone="info">{compiledResult.riskTier}</Badge>
                  </div>
                  <p className="widget-explanation">{compiledResult.explanation}</p>

                  <div className="widget-controls">
                    <div className="widget-slider-group">
                      <div className="widget-slider-label">
                        <span>Max per Transaction</span>
                        <strong>{(Number(compiledResult.maxPerTx) / 1_000_000).toFixed(2)} USDC</strong>
                      </div>
                      <input
                        type="range"
                        min="5"
                        max="500"
                        step="5"
                        value={Number(compiledResult.maxPerTx) / 1_000_000}
                        onChange={(e) =>
                          setCompiledResult({
                            ...compiledResult,
                            maxPerTx: (parseInt(e.target.value, 10) * 1_000_000).toString(),
                          })
                        }
                      />
                    </div>

                    <div className="widget-slider-group">
                      <div className="widget-slider-label">
                        <span>Hourly Window Ceiling</span>
                        <strong>{(Number(compiledResult.maxPerWindow) / 1_000_000).toFixed(2)} USDC</strong>
                      </div>
                      <input
                        type="range"
                        min="50"
                        max="5000"
                        step="50"
                        value={Number(compiledResult.maxPerWindow) / 1_000_000}
                        onChange={(e) =>
                          setCompiledResult({
                            ...compiledResult,
                            maxPerWindow: (parseInt(e.target.value, 10) * 1_000_000).toString(),
                          })
                        }
                      />
                    </div>

                    <div className="widget-slider-group">
                      <div className="widget-slider-label">
                        <span>Velocity Limit</span>
                        <strong>{compiledResult.maxVelocity} calls / window</strong>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="100"
                        step="1"
                        value={compiledResult.maxVelocity}
                        onChange={(e) =>
                          setCompiledResult({
                            ...compiledResult,
                            maxVelocity: parseInt(e.target.value, 10),
                          })
                        }
                      />
                    </div>
                  </div>

                  {/* Mathematical invariant guard: maxPerTx must never exceed maxPerWindow.
                      This mirrors the Qwen backend's bounds enforcement (ADR-0008). */}
                  {(() => {
                    const txVal = Number(compiledResult.maxPerTx);
                    const windowVal = Number(compiledResult.maxPerWindow);
                    const invariantViolated = txVal > windowVal;
                    return invariantViolated ? (
                      <div className="copilot-invariant-warning" role="alert">
                        <AlertTriangle size={14} className="copilot-invariant-icon" />
                        <span>
                          <strong>Policy Invariant Violated</strong> — Max per Transaction (
                          {(txVal / 1_000_000).toFixed(2)} USDC) exceeds the Hourly Window Ceiling (
                          {(windowVal / 1_000_000).toFixed(2)} USDC). Reduce the transaction limit or raise the window ceiling before applying.
                        </span>
                      </div>
                    ) : null;
                  })()}

                  <div className="widget-actions">
                    <Button
                      variant="filled"
                      onClick={handleApplyToPolicyStudio}
                      disabled={
                        applied ||
                        Number(compiledResult.maxPerTx) > Number(compiledResult.maxPerWindow)
                      }
                    >
                      {applied ? (
                        <>
                          <CheckCircle2 size={15} /> Applying to Policy Studio…
                        </>
                      ) : (
                        <>
                          Apply to Policy Studio <ArrowRight size={15} />
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
