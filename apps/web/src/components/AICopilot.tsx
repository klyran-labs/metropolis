import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import {
  Sparkles,
  X,
  ShieldAlert,
  CheckCircle2,
  ArrowRight,
  Sliders,
  Terminal,
  AlertTriangle,
  Loader2,
  Search,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useCompilePolicy, type CompiledPolicyResult } from "../api";
import { Badge, Button, formatRiskTier } from "../design-system";
import { ONCHAIN_REASON_CODES } from "../hooks/usePolicyContracts";

interface WorkloadPreset {
  id: string;
  name: string;
  badge: string;
  summary: string;
  prompt: string;
}

const WORKLOAD_PRESETS: WorkloadPreset[] = [
  {
    id: "micro-inference",
    name: "Micro Inference",
    badge: "$10 / tx · $100 / hr",
    summary: "Autonomous scraping and inference calls",
    prompt: "Autonomous LLM agent making up to $10 micro-inference calls, max $100 per hour.",
  },
  {
    id: "defi-rebalancer",
    name: "DeFi Rebalancer",
    badge: "$250 / tx · $2,000 / hr",
    summary: "High-cadence liquidity and rebalancing swaps",
    prompt: "High-cadence trading agent executing up to $250 rebalancing swaps, max $2000 per hour with strict whitelist.",
  },
  {
    id: "procurement",
    name: "B2B Procurement",
    badge: "$500 / tx · $5,000 / hr",
    summary: "Automated invoice dispatch and merchant billing",
    prompt: "Autonomous procurement agent executing up to $500 invoice settlements, max $5000 per hour with approved merchants.",
  },
  {
    id: "telemetry-oracle",
    name: "Telemetry Oracle",
    badge: "$1 / tx · $25 / hr",
    summary: "Periodic state pings and high-frequency oracles",
    prompt: "High-frequency telemetry reporter executing up to $1 oracle pings, max $25 per hour with velocity cap 60.",
  },
];

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
  const [reasonSearch, setReasonSearch] = useState("");
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    drawerRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  const filteredReasonCodes = useMemo(() => {
    const q = reasonSearch.trim().toLowerCase();
    if (!q) return Object.entries(ONCHAIN_REASON_CODES);
    return Object.entries(ONCHAIN_REASON_CODES).filter(([codeStr, item]) => {
      return (
        codeStr.includes(q) ||
        item.code.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.desc.toLowerCase().includes(q) ||
        item.remediation.toLowerCase().includes(q)
      );
    });
  }, [reasonSearch]);

  const activePresetId = useMemo(() => {
    const matched = WORKLOAD_PRESETS.find((p) => p.prompt === prompt);
    return matched ? matched.id : null;
  }, [prompt]);

  const handleCompile = () => {
    if (!prompt.trim() || compilePolicy.isPending) return;
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

  if (!open) return null;

  const drawerElement = (
    <div className="copilot-backdrop" onClick={onClose}>
      <aside
        ref={drawerRef}
        className="copilot-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="copilot-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="copilot-header">
          <div className="copilot-title">
            <Sparkles size={18} className="copilot-sparkle-icon" />
            <div>
              <h3 id="copilot-title">AI Risk Copilot</h3>
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
                <div className="copilot-input-header">
                  <span className="copilot-input-label">
                    <Sparkles size={12} className="copilot-sparkle-icon" />
                    Agent Workload Intent
                  </span>
                  {prompt.length > 0 && (
                    <button
                      type="button"
                      className="copilot-clear-btn"
                      onClick={() => {
                        setPrompt("");
                        setCompiledResult(null);
                        setApplied(false);
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <textarea
                  className="copilot-textarea"
                  placeholder="Describe your agent workload (e.g., 'Autonomous scraping bot making up to $25 payments per call, max $300/hr, strict merchant whitelist')..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                />
                <div className="copilot-input-footer">
                  <span className="copilot-input-hint">
                    <Terminal size={12} />
                    Synthesizes Monad EVM PackedPolicy storage slots
                  </span>
                  <Button
                    type="button"
                    variant="filled"
                    onClick={handleCompile}
                    disabled={!prompt.trim() || compilePolicy.isPending}
                  >
                    {compilePolicy.isPending ? (
                      <>
                        <Loader2 size={14} className="spin" />
                        <span>Synthesizing…</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} />
                        <span>Compile Policy</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="copilot-presets-section">
                <div className="copilot-presets-header">
                  <span className="copilot-preset-label">Workload Archetypes</span>
                  <small className="copilot-preset-sublabel">Select a preset to populate prompt</small>
                </div>
                <div className="copilot-chips">
                  {WORKLOAD_PRESETS.map((preset) => {
                    const isActive = activePresetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={`prompt-chip ${isActive ? "active" : ""}`}
                        onClick={() => {
                          setPrompt(preset.prompt);
                          setCompiledResult(null);
                          setApplied(false);
                        }}
                      >
                        <div className="prompt-chip-top">
                          <span className="prompt-chip-name">{preset.name}</span>
                          <span className="prompt-chip-badge">{preset.badge}</span>
                        </div>
                        <span className="prompt-chip-desc">{preset.summary}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {compiledResult ? (
                <div className="copilot-widget-card">
                  <div className="widget-header">
                    <span className="widget-badge">
                      <Sparkles size={12} /> Synthesized Policy (Alibaba Qwen 3.8 Max)
                    </span>
                    <Badge tone="info">{formatRiskTier(compiledResult.riskTier)}</Badge>
                  </div>
                  <div className="widget-explanation-box">
                    <p className="widget-explanation">{compiledResult.explanation}</p>
                  </div>

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

                  {compiledResult.suggestedMerchants && compiledResult.suggestedMerchants.length > 0 && (
                    <div className="widget-merchants-box">
                      <span className="widget-merchants-label">Suggested Merchant Whitelist</span>
                      <div className="widget-merchant-chips">
                        {compiledResult.suggestedMerchants.map((merchant, idx) => (
                          <span key={idx} className="widget-merchant-chip">
                            {merchant}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

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
                      type="button"
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
              ) : (
                <div className="copilot-guide-card">
                  <div className="copilot-guide-header">
                    <Terminal size={15} className="copilot-sparkle-icon" />
                    <span>Autonomous Policy Architecture</span>
                  </div>
                  <p className="copilot-guide-desc">
                    The AI Risk Copilot parses plain-language specifications into deterministic Monad EVM PackedPolicy storage slots:
                  </p>
                  <div className="copilot-guide-grid">
                    <div className="copilot-guide-slot">
                      <span className="slot-badge">Slot 0</span>
                      <strong>Single Tx Cap (maxPerTx)</strong>
                      <p>Atomic ceiling preventing individual rogue or drained transactions.</p>
                    </div>
                    <div className="copilot-guide-slot">
                      <span className="slot-badge">Slot 1</span>
                      <strong>Rolling Epoch (maxPerWindow)</strong>
                      <p>Cumulative hourly expenditure ceiling evaluated in disjoint storage.</p>
                    </div>
                    <div className="copilot-guide-slot">
                      <span className="slot-badge">Slot 2</span>
                      <strong>Velocity Limit (maxVelocity)</strong>
                      <p>Upper bound on transaction dispatch rate within the sliding epoch.</p>
                    </div>
                    <div className="copilot-guide-slot">
                      <span className="slot-badge">Slot 3</span>
                      <strong>Merchant Whitelist</strong>
                      <p>Strict address verification for permitted counterparty contracts.</p>
                    </div>
                  </div>
                  <div className="copilot-guide-footer">
                    <ShieldAlert size={14} className="copilot-sparkle-icon" />
                    <span>Zero-Reentrancy Guard · O(1) Short-Circuit Kill Switch · EIP-712 Settlement</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="copilot-diagnostics-view">
              <p className="copilot-intro">
                Inspect standardized onchain ReasonCodes returned during policy evaluation or circuit trips. Select any code to review its invariant trigger conditions and operational remediation steps.
              </p>

              <div className="copilot-search-box">
                <Search size={14} className="copilot-search-icon" />
                <input
                  type="text"
                  className="copilot-search-input"
                  placeholder="Search reason codes (e.g. kill switch, velocity, nonce)..."
                  value={reasonSearch}
                  onChange={(e) => setReasonSearch(e.target.value)}
                />
              </div>

              <div className="reason-code-list">
                {filteredReasonCodes.map(([codeStr, item]) => {
                  const code = parseInt(codeStr, 10);
                  const isSelected = selectedReasonCode === code;
                  const isKillSwitch = code === 1;
                  return (
                    <div
                      key={code}
                      className={`reason-code-item ${isSelected ? "selected" : ""}`}
                      onClick={() => setSelectedReasonCode(isSelected ? null : code)}
                    >
                      <div className="reason-code-header">
                        <div className="reason-code-left">
                          <span className={`reason-code-pill ${isKillSwitch ? "kill-switch" : ""}`}>
                            Code {code}
                          </span>
                          <strong>{item.code}</strong>
                        </div>
                        {isSelected ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
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

  return typeof document !== "undefined" ? createPortal(drawerElement, document.body) : drawerElement;
}

export default AICopilot;

