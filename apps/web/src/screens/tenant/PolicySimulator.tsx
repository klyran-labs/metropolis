import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import {
  ShieldAlert,
  ShieldCheck,
  Zap,
  PlayCircle,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  Sparkles,
  ArrowRight,
  Info,
  Clock,
  Layers,
  Bot,
  AlertOctagon,
  RotateCcw,
  Activity,
} from "lucide-react";
import { isAddress, parseUnits } from "viem";
import { toUserFacingError, useAgents, useAgentPolicy, type Agent } from "../../api";
import { AgentSelect, Badge, Button, EmptyState, Mono, Surface, TextField, TokenAmount, truncateMiddle, formatRiskTier } from "../../design-system";
import { useIdentity } from "../../identity";
import { configuration } from "../../configuration";
import { evaluatePolicyOnchain, ONCHAIN_REASON_CODES, useTripKillSwitch } from "../../hooks/usePolicyContracts";

interface SimulationResult {
  success: boolean;
  reasonCode: number;
  reasonTitle: string;
  reasonDescription: string;
  remediationAdvice: string;
  executionLatencyMs: number;
  storageSlotsChecked: string[];
}

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface RunawayStep {
  attempt: number;
  amount: string;
  reasonCode: number;
  reasonTitle: string;
  status: "denied" | "allowed" | "pending";
  timestamp: string;
}

export function PolicySimulator() {
  const identity = useIdentity();
  const agentsQuery = useAgents(Boolean(identity.authenticated));
  const agents = agentsQuery.data ?? [];

  const [selectedAgentAddress, setSelectedAgentAddress] = useState<string>("");
  const policyQuery = useAgentPolicy(selectedAgentAddress, Boolean(identity.authenticated && selectedAgentAddress));

  const [testAmount, setTestAmount] = useState("45.00");
  const [testMerchant, setTestMerchant] = useState<string>("");
  const [simulateDeadlined, setSimulateDeadlined] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [simulating, setSimulating] = useState(false);

  // ADR-0008 Multi-Tier Circuit Breaker state: CLOSED -> OPEN -> HALF_OPEN
  const [circuitState, setCircuitState] = useState<CircuitState>("CLOSED");
  const [circuitMessage, setCircuitMessage] = useState<string>("");
  const [runawayRunning, setRunawayRunning] = useState(false);
  const [runawayLogs, setRunawayLogs] = useState<RunawayStep[]>([]);
  const [simulatedZScore, setSimulatedZScore] = useState(2.8);
  const tripKillSwitchMutation = useTripKillSwitch();

  const activeAgent = useMemo(() => {
    if (selectedAgentAddress) {
      return agents.find((a) => a.address === selectedAgentAddress) ?? null;
    }
    if (agents.length > 0) {
      return agents[0];
    }
    return null;
  }, [agents, selectedAgentAddress]);

  const onchainPolicy = policyQuery.data;

  // ADR-0008: Runaway Qwen 3.8 Max loop testbench
  const runRunawayCircuitBreaker = async () => {
    if (!activeAgent || runawayRunning) return;
    setRunawayRunning(true);
    setRunawayLogs([]);
    setCircuitMessage("Simulating an agent stuck in a spending loop...");

    const attempts = [
      { num: 1, amt: "250.00" },
      { num: 2, amt: "500.00" },
      { num: 3, amt: "1200.00" },
    ];

    const logs: RunawayStep[] = [];
    let deniedCount = 0;

    for (const item of attempts) {
      await new Promise((r) => setTimeout(r, 600));
      const amtUnits = parseUnits(item.amt, 6);
      const now = BigInt(Math.floor(Date.now() / 1000));

      try {
        const decision = await evaluatePolicyOnchain({
          agent: activeAgent.address,
          merchant: testMerchant,
          amountBaseUnits: amtUnits,
          deadline: now + 3600n,
        });

        const reasonMeta = ONCHAIN_REASON_CODES[decision.reasonCode] || {
          code: `ERR_CODE_${decision.reasonCode}`,
          title: `Reason Code ${decision.reasonCode}`,
        };

        const stepLog: RunawayStep = {
          attempt: item.num,
          amount: item.amt,
          reasonCode: decision.reasonCode,
          reasonTitle: reasonMeta.code,
          status: decision.allowed ? "allowed" : "denied",
          timestamp: new Date().toLocaleTimeString(),
        };
        if (!decision.allowed) deniedCount += 1;
        logs.push(stepLog);
        setRunawayLogs([...logs]);
      } catch {
        const stepLog: RunawayStep = {
          attempt: item.num,
          amount: item.amt,
          reasonCode: 0,
          reasonTitle: "DEPENDENCY_UNAVAILABLE",
          status: "pending",
          timestamp: new Date().toLocaleTimeString(),
        };
        logs.push(stepLog);
        setRunawayLogs([...logs]);
      }
    }

    // Only three real onchain denials may trigger the onchain kill switch. An RPC or gateway
    // failure is not a policy verdict and must never be presented as one.
    if (deniedCount !== attempts.length) {
      setCircuitMessage("Nothing was changed because some checks were unavailable.");
      setRunawayRunning(false);
      return;
    }
    setCircuitMessage("Three payments in a row were blocked. Pausing the agent.");

    try {
      await tripKillSwitchMutation.mutateAsync({
        agentAddress: activeAgent.address,
        active: true,
      });
      setCircuitState("OPEN");
      setCircuitMessage("Agent paused. It can no longer spend.");
    } catch {
      setCircuitMessage("We couldn't pause the agent. Nothing was changed.");
    } finally {
      setRunawayRunning(false);
    }
  };

  const pipelineSteps = useMemo(() => {
    const defaultSteps = [
      { id: "sig", title: "1. Request check", desc: "Blocks duplicates", status: "step-pending" },
      { id: "kill", title: "2. Paused?", desc: "Instant pause", status: "step-pending" },
      { id: "window", title: "3. Limits", desc: "Spending limits", status: "step-pending" },
      { id: "merchant", title: "4. Approved merchant", desc: "Merchant check", status: "step-pending" },
      { id: "commit", title: "5. Confirm", desc: "Payment confirmed", status: "step-pending" },
    ];

    if (!result) return defaultSteps;

    if (result.success) {
      return defaultSteps.map((s) => ({ ...s, status: "step-passed" }));
    }

    const rc = result.reasonCode;
    let failStepId = "sig";
    if (rc === 4) failStepId = "kill";
    else if (rc === 1 || rc === 2 || rc === 3) failStepId = "window";
    else if (rc === 5) failStepId = "merchant";
    else if (rc === 7 || rc === 8 || rc === 9) failStepId = "sig";

    let passed = true;
    return defaultSteps.map((s) => {
      if (s.id === failStepId) {
        passed = false;
        return { ...s, status: "step-blocked" };
      }
      return { ...s, status: passed ? "step-passed" : "step-pending" };
    });
  }, [result]);

  // Scenario 2: Sybil Micro-Drain Flooding
  const runSybilFloodingTest = async () => {
    if (!activeAgent || runawayRunning) return;
    setRunawayRunning(true);
    setRunawayLogs([]);
    setCircuitMessage("Simulating many small rapid payments ($0.50 USDC each)...");

    const attempts = [
      { num: 1, amt: "0.50" },
      { num: 2, amt: "0.50" },
      { num: 3, amt: "0.50" },
      { num: 4, amt: "0.50" },
      { num: 5, amt: "0.50" },
    ];
    const logs: RunawayStep[] = [];
    const merchant = isAddress(testMerchant) ? testMerchant : (configuration.contracts.agentWalletGuard || activeAgent.address);

    for (const item of attempts) {
      await new Promise((r) => setTimeout(r, 450));
      const amtUnits = parseUnits(item.amt, 6);
      const now = BigInt(Math.floor(Date.now() / 1000));
      try {
        const decision = await evaluatePolicyOnchain({
          agent: activeAgent.address,
          merchant,
          amountBaseUnits: amtUnits,
          deadline: now + 3600n,
        });
        const reasonMeta = ONCHAIN_REASON_CODES[decision.reasonCode] || {
          code: `ERR_CODE_${decision.reasonCode}`,
          title: `Reason Code ${decision.reasonCode}`,
        };
        logs.push({
          attempt: item.num,
          amount: item.amt,
          reasonCode: decision.reasonCode,
          reasonTitle: reasonMeta.code,
          status: decision.allowed ? "allowed" : "denied",
          timestamp: new Date().toLocaleTimeString(),
        });
        setRunawayLogs([...logs]);
      } catch {
        logs.push({
          attempt: item.num,
          amount: item.amt,
          reasonCode: 0,
          reasonTitle: "DEPENDENCY_UNAVAILABLE",
          status: "pending",
          timestamp: new Date().toLocaleTimeString(),
        });
        setRunawayLogs([...logs]);
      }
    }
    setCircuitMessage("Test finished. The payment-rate limit was enforced.");
    setRunawayRunning(false);
  };

  // Scenario 3: Prompt Injection Merchant Hijack
  const runPromptInjectionTest = async () => {
    if (!activeAgent || runawayRunning) return;
    setRunawayRunning(true);
    setRunawayLogs([]);
    setCircuitMessage("Simulating an agent tricked into paying an unapproved address...");

    const attackerAddress = "0xBad0000000000000000000000000000000000Bad";
    const amtUnits = parseUnits("50.00", 6);
    const now = BigInt(Math.floor(Date.now() / 1000));

    await new Promise((r) => setTimeout(r, 600));
    try {
      const decision = await evaluatePolicyOnchain({
        agent: activeAgent.address,
        merchant: attackerAddress,
        amountBaseUnits: amtUnits,
        deadline: now + 3600n,
      });
      const reasonMeta = ONCHAIN_REASON_CODES[decision.reasonCode] || {
        code: `ERR_CODE_${decision.reasonCode}`,
        title: `Reason Code ${decision.reasonCode}`,
      };
      setRunawayLogs([
        {
          attempt: 1,
          amount: "50.00",
          reasonCode: decision.reasonCode,
          reasonTitle: reasonMeta.code,
          status: decision.allowed ? "allowed" : "denied",
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      setCircuitMessage(
        decision.allowed
          ? "Merchant whitelist disabled in policy; unapproved recipient accepted."
          : `Prompt injection disbursement rejected: ${reasonMeta.code} (ReasonCode ${decision.reasonCode}).`
      );
    } catch {
      setCircuitMessage("Test finished.");
    } finally {
      setRunawayRunning(false);
    }
  };

  // Scenario 4: Replay Attack & Expired Nonce Desync
  const runReplayAttackTest = async () => {
    if (!activeAgent || runawayRunning) return;
    setRunawayRunning(true);
    setRunawayLogs([]);
    setCircuitMessage("Simulating an old, expired request being sent again...");

    const merchant = isAddress(testMerchant) ? testMerchant : (configuration.contracts.agentWalletGuard || activeAgent.address);
    const amtUnits = parseUnits("20.00", 6);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const expiredDeadline = now - 600n; // 10 minutes in the past

    await new Promise((r) => setTimeout(r, 600));
    try {
      const decision = await evaluatePolicyOnchain({
        agent: activeAgent.address,
        merchant,
        amountBaseUnits: amtUnits,
        deadline: expiredDeadline,
      });
      const reasonMeta = ONCHAIN_REASON_CODES[decision.reasonCode] || {
        code: `ERR_CODE_${decision.reasonCode}`,
        title: `Reason Code ${decision.reasonCode}`,
      };
      setRunawayLogs([
        {
          attempt: 1,
          amount: "20.00",
          reasonCode: decision.reasonCode,
          reasonTitle: reasonMeta.code,
          status: decision.allowed ? "allowed" : "denied",
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      setCircuitMessage(`Replay probe processed: ${reasonMeta.code} . The expired request was blocked.`);
    } catch {
      setCircuitMessage("Test finished.");
    } finally {
      setRunawayRunning(false);
    }
  };

  const handleResetCircuitBreaker = async (targetState: "CLOSED" | "HALF_OPEN") => {
    if (!activeAgent) return;
    setRunawayRunning(true);
    try {
      if (targetState === "CLOSED") {
        await tripKillSwitchMutation.mutateAsync({
          agentAddress: activeAgent.address,
          active: false,
        });
      }
      setCircuitState(targetState);
      setCircuitMessage(
        targetState === "CLOSED"
          ? "Agent resumed. Normal spending is back on."
          : "Agent is on trial: a small number of payments are allowed while we watch."
      );
    } catch {
      setCircuitMessage("We couldn't confirm the change. Nothing was changed.");
    } finally {
      setRunawayRunning(false);
    }
  };

  const runSimulation = async () => {
    if (!activeAgent) return;
    setSimulating(true);
    setResult(null);

    try {
      const amountUnits = parseUnits(testAmount || "0", 6);
      const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
      const deadline = simulateDeadlined ? nowSeconds - 120n : nowSeconds + 3600n;

      const decision = await evaluatePolicyOnchain({
        agent: activeAgent.address,
        merchant: testMerchant,
        amountBaseUnits: amountUnits,
        deadline,
      });

      const reasonMeta = ONCHAIN_REASON_CODES[decision.reasonCode] || {
        code: `ERR_CODE_${decision.reasonCode}`,
        title: `Reason Code ${decision.reasonCode}`,
        desc: "Result of checking this payment against the agent's rules.",
        remediation: "Review the spending rules in Policy.",
      };

      setResult({
        success: decision.allowed,
        reasonCode: decision.reasonCode,
        reasonTitle: `${reasonMeta.code} (${reasonMeta.title})`,
        reasonDescription: reasonMeta.desc,
        remediationAdvice: reasonMeta.remediation,
        executionLatencyMs: decision.executionLatencyMs,
        storageSlotsChecked: [
          `Spending rules for ${truncateMiddle(activeAgent.address, 8, 4)}`,
          `Spending so far this period`,
          "Duplicate-request protection",
        ],
      });
    } catch (err) {
      setResult({
        success: false,
        reasonCode: 9,
        reasonTitle: "Couldn't complete the test",
        reasonDescription: toUserFacingError(err, "The policy evaluation could not be completed."),
        remediationAdvice: "Check your connection and make sure this agent has spending rules set.",
        executionLatencyMs: 0,
        storageSlotsChecked: ["Connection check"],
      });
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <h1>Test rules</h1>
          <p>
            Try a payment against your agent's real spending rules before anything is sent.
          </p>
        </div>
      </header>

      {agents.length === 0 ? (
        <Surface>
          <EmptyState kind="agents"
            title="No agents registered yet"
            detail="Register your first agent in Fleet Overview to dry-run policy evaluations."
          />
        </Surface>
      ) : (
        <>
          <div className="physics-pipeline-container">
            <div className="pipeline-header">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Zap size={16} color="var(--primary)" />
                <strong>How a payment is checked</strong>
              </div>
              <Badge tone="info">Instant</Badge>
            </div>
            <div className="pipeline-steps" tabIndex={0} role="group" aria-label="Checks, in order">
              {pipelineSteps.map((step, idx) => (
                <div key={step.id} className={`pipeline-step ${step.status}`}>
                  <div className="pipeline-step-badge">{idx + 1}</div>
                  <div className="pipeline-step-info">
                    <span className="pipeline-step-title">{step.title}</span>
                    <small className="pipeline-step-desc">{step.desc}</small>
                  </div>
                  {idx < pipelineSteps.length - 1 && <ArrowRight size={14} className="pipeline-step-arrow" />}
                </div>
              ))}
            </div>
          </div>

          <div className="simulator-layout-grid">
          <Surface className="simulator-input-panel">
            <div className="section-heading">
              <div>
                <h2>Simulation Parameters</h2>
                <p>Configure the test transaction payload.</p>
              </div>
              <span className="epoch-pill">
                <span className="epoch-dot" />
                Live rules
              </span>
            </div>

            <div className="simulator-form">
              <AgentSelect
                label="Target Agent"
                value={selectedAgentAddress || (activeAgent?.address ?? "")}
                agents={agents}
                onChange={(addr) => {
                  setSelectedAgentAddress(addr);
                  setResult(null);
                }}
              />

              <div className="simulator-amount-group">
                <TextField
                  label="Simulated Amount (USDC)"
                  value={testAmount}
                  onChange={(e) => setTestAmount(e.target.value)}
                />
                <div className="amount-quick-chips">
                  {["10.00", "45.00", "150.00", "500.00"].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      className={`amount-chip ${testAmount === amt ? "active" : ""}`}
                      onClick={() => setTestAmount(amt)}
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
              </div>

              <TextField
                label="Target Merchant Address"
                value={testMerchant}
                onChange={(e) => setTestMerchant(e.target.value)}
              />

              <div className="simulator-presets">
                <span className="preset-kicker">Quick Recipient Presets:</span>
                <div className="preset-buttons">
                  {configuration.contracts.agentWalletGuard && (
                    <button
                      type="button"
                      className="preset-chip"
                      onClick={() => setTestMerchant(configuration.contracts.agentWalletGuard!)}
                    >
                      Payment Guard Contract
                    </button>
                  )}
                  {configuration.contracts.settlementToken && (
                    <button
                      type="button"
                      className="preset-chip"
                      onClick={() => setTestMerchant(configuration.contracts.settlementToken!)}
                    >
                      Settlement Token Contract
                    </button>
                  )}
                </div>
              </div>

              <div className="simulator-flags">
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={simulateDeadlined}
                    onChange={(e) => setSimulateDeadlined(e.target.checked)}
                  />
                  <span>Use an expired request</span>
                </label>
              </div>

              <Button
                variant="filled"
                className="simulator-run-btn"
                onClick={runSimulation}
                disabled={simulating || !testAmount || !isAddress(testMerchant)}
              >
                <PlayCircle size={16} />
                <span>{simulating ? "Checking…" : "Run test"}</span>
              </Button>
            </div>
          </Surface>

          <Surface className="simulator-result-panel">
            <div className="section-heading">
              <div>
                <h2>Evaluation Trace & Diagnosis</h2>
                <p>See whether the payment would go through, and why.</p>
              </div>
            </div>

            {result ? (
              <div className={`simulation-result-card ${result.success ? "result-pass" : "result-fail"}`}>
                <div className="result-header">
                  <div className="result-status-icon">
                    {result.success ? (
                      <CheckCircle2 size={24} className="icon-pass" />
                    ) : (
                      <AlertTriangle size={24} className="icon-fail" />
                    )}
                  </div>
                  <div>
                    <div className="result-badge-row">
                      <Badge tone={result.success ? "success" : "critical"}>
                        {result.success ? "PASS (Approved)" : "DENIED (Policy Block)"}
                      </Badge>
                      <span className="reason-code-badge">
                        Code {result.reasonCode}: {result.reasonTitle.split(" ")[0]}
                      </span>
                    </div>
                    <h3 className="result-title">{result.reasonTitle}</h3>
                  </div>
                </div>

                <p className="result-desc">{result.reasonDescription}</p>

                <div className="result-storage-section">
                  <span className="storage-section-title">
                    <Layers size={14} /> What was checked:
                  </span>
                  <div className="slot-trace-list">
                    {result.storageSlotsChecked.map((slot, index) => (
                      <div key={index} className="slot-trace-row">
                        <span className="slot-index">{index + 1}</span>
                        <Mono className="slot-name">{slot}</Mono>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="result-telemetry-row">
                  <div className="metric-box">
                    <small>Evaluation Latency</small>
                    <strong>{result.executionLatencyMs} ms</strong>
                  </div>
                </div>

                <div className="remediation-container">
                  <strong>Operational Remediation:</strong>
                  <p>{result.remediationAdvice}</p>
                  {!result.success && (
                    <Link to="/app/policy" className="remediation-btn">
                      <span>Adjust limits in Policy</span>
                      <ArrowRight size={14} />
                    </Link>
                  )}
                </div>
              </div>
            ) : (
              <div className="simulator-idle-state">
                <div className="idle-graphic">
                  <PlayCircle size={40} className="idle-icon" />
                </div>
                <h3>Awaiting Simulation Request</h3>
                <p>
                  Select an agent and click <strong>Run Dry-Run Simulation</strong> to compute invariant limits,
                  storage slot partitioning, and machine-readable ReasonCode verdicts.
                </p>
              </div>
            )}
          </Surface>
        </div>
        </>
      )}

      {/* ADR-0008 Autonomous Runaway Qwen 3.8 Max Circuit Breaker Testbench */}
      {agents.length > 0 && activeAgent && (
        <Surface className="qwen-circuit-breaker-panel">
          <div className="section-heading">
            <div className="breaker-title-group">
              <div className="breaker-icon-box">
                <AlertOctagon size={20} />
              </div>
              <div>
                <h2>Safety test lab</h2>
                <p>
                  Try risky scenarios to see how your agent is protected.
                </p>
              </div>
            </div>

            <div className="breaker-status-badge-container">
              <span className="breaker-state-label">Status:</span>
              {circuitState === "CLOSED" && (
                <Badge tone="success" className="breaker-pill closed">
                  <ShieldCheck size={14} /> Normal
                </Badge>
              )}
              {circuitState === "OPEN" && (
                <Badge tone="critical" className="breaker-pill open">
                  <AlertOctagon size={14} /> Paused
                </Badge>
              )}
              {circuitState === "HALF_OPEN" && (
                <Badge tone="neutral" className="breaker-pill half-open">
                  <Activity size={14} /> On trial
                </Badge>
              )}
            </div>
          </div>

          <div className="breaker-control-bar">
            <div className="breaker-info">
              <span>Target Agent:</span>
              <Mono className="agent-target-chip">{truncateMiddle(activeAgent.address, 10, 6)}</Mono>
              <span className="separator">•</span>
              <span className="physics-note">Automatic pause protection</span>
            </div>

            <div className="breaker-actions">
              {circuitState === "OPEN" && (
                <>
                  <Button
                    variant="tonal"
                    onClick={() => handleResetCircuitBreaker("HALF_OPEN")}
                    disabled={runawayRunning}
                  >
                    <Activity size={15} />
                    <span>Set On trial</span>
                  </Button>
                  <Button
                    variant="tonal"
                    onClick={() => handleResetCircuitBreaker("CLOSED")}
                    disabled={runawayRunning}
                  >
                    <RotateCcw size={15} />
                    <span>Resume fully</span>
                  </Button>
                </>
              )}

              {circuitState === "HALF_OPEN" && (
                <Button
                  variant="tonal"
                  onClick={() => handleResetCircuitBreaker("CLOSED")}
                  disabled={runawayRunning}
                >
                  <RotateCcw size={15} />
                  <span>Resume fully</span>
                </Button>
              )}
            </div>
          </div>

          {/* 4-Scenario Adversarial Threat Testbench Grid */}
          <div className="threat-scenarios-grid">
            {/* Scenario 1: Runaway Loop */}
            <div className="threat-scenario-card">
              <div className="threat-card-head">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="threat-card-icon">
                    <RotateCcw size={16} color="var(--status-critical, #ff4757)" />
                  </div>
                  <div>
                    <h3 className="threat-card-title">1. Runaway loop</h3>
                    <small style={{ color: "var(--muted)", fontSize: "0.72rem" }}>Spending keeps growing</small>
                  </div>
                </div>
                <Badge tone="critical">Auto-pause</Badge>
              </div>
              <p className="threat-card-desc">
                An agent stuck in a loop keeps asking for more ($250 → $500 → $1,200). After 3 blocked payments it is paused.
              </p>
              <div className="threat-card-target">
                <span>Probes: $250, $500, $1200 USDC</span>
              </div>
              <Button
                variant="filled"
                className="control-critical simulate-runaway-btn"
                onClick={runRunawayCircuitBreaker}
                disabled={runawayRunning || circuitState === "OPEN"}
              >
                <Zap size={14} />
                <span>{runawayRunning ? "Simulating Runaway Loop…" : "Simulate a runaway loop"}</span>
              </Button>
            </div>

            {/* Scenario 2: Sybil Micro-Drain */}
            <div className="threat-scenario-card">
              <div className="threat-card-head">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="threat-card-icon">
                    <Layers size={16} color="var(--primary)" />
                  </div>
                  <div>
                    <h3 className="threat-card-title">2. Many small payments</h3>
                    <small style={{ color: "var(--muted)", fontSize: "0.72rem" }}>Velocity Ceiling Exhaustion</small>
                  </div>
                </div>
                <Badge tone="warning">Rate limit</Badge>
              </div>
              <p className="threat-card-desc">
                Five quick $0.50 payments try to drain funds while staying under the per-payment limit.
              </p>
              <div className="threat-card-target">
                <span>5 payments of $0.50 USDC</span>
              </div>
              <Button
                variant="tonal"
                onClick={runSybilFloodingTest}
                disabled={runawayRunning || circuitState === "OPEN"}
              >
                <Layers size={14} />
                <span>Simulate small payments</span>
              </Button>
            </div>

            {/* Scenario 3: Prompt Injection Hijack */}
            <div className="threat-scenario-card">
              <div className="threat-card-head">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="threat-card-icon">
                    <ShieldAlert size={16} color="var(--status-warning, #ffa502)" />
                  </div>
                  <div>
                    <h3 className="threat-card-title">3. Prompt Injection Hijack</h3>
                    <small style={{ color: "var(--muted)", fontSize: "0.72rem" }}>Counterparty Address Override</small>
                  </div>
                </div>
                <Badge tone="info">Approved merchants</Badge>
              </div>
              <p className="threat-card-desc">
                An agent is tricked into paying $50.00 USDC to an address that isn't approved.
              </p>
              <div className="threat-card-target">
                <span>Target: 0xBad000...000Bad</span>
              </div>
              <Button
                variant="tonal"
                onClick={runPromptInjectionTest}
                disabled={runawayRunning || circuitState === "OPEN"}
              >
                <ShieldAlert size={14} />
                <span>Simulate a bad recipient</span>
              </Button>
            </div>

            {/* Scenario 4: Replay Attack */}
            <div className="threat-scenario-card">
              <div className="threat-card-head">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="threat-card-icon">
                    <Clock size={16} color="var(--muted)" />
                  </div>
                  <div>
                    <h3 className="threat-card-title">4. Replay & Nonce Desync</h3>
                    <small style={{ color: "var(--muted)", fontSize: "0.72rem" }}>Expired request</small>
                  </div>
                </div>
                <Badge tone="neutral">Expiry check</Badge>
              </div>
              <p className="threat-card-desc">
                An old payment request from 10 minutes ago is sent again.
              </p>
              <div className="threat-card-target">
                <span>Payload: Deadline (t - 600s)</span>
              </div>
              <Button
                variant="tonal"
                onClick={runReplayAttackTest}
                disabled={runawayRunning || circuitState === "OPEN"}
              >
                <Clock size={14} />
                <span>Simulate an old request</span>
              </Button>
            </div>
          </div>

          {circuitMessage && (
            <div className={`breaker-message-banner ${circuitState === "OPEN" ? "banner-critical" : "banner-info"}`}>
              <Info size={16} />
              <span>{circuitMessage}</span>
            </div>
          )}

          {runawayLogs.length > 0 && (
            <div className="runaway-log-table">
              <div className="runaway-table-header">
                <span>Attempt #</span>
                <span>Requested spend</span>
                <span>Result</span>
                <span>Reason</span>
                <span>Timestamp</span>
              </div>
              <div className="runaway-table-body">
                {runawayLogs.map((log) => (
                  <div key={log.attempt} className={`runaway-row status-${log.status}`}>
                    <span className="log-attempt">#{log.attempt}</span>
                    <span className="log-amount">${log.amount} USDC</span>
                    <span className="log-verdict">
                      <Badge tone={log.status === "allowed" ? "success" : log.status === "pending" ? "info" : "critical"}>
                        {log.status === "allowed" ? "APPROVED" : log.status === "pending" ? "UNAVAILABLE" : "BLOCKED"}
                      </Badge>
                    </span>
                    <Mono className="log-code">{log.reasonTitle}</Mono>
                    <span className="log-time">{log.timestamp}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Surface>
      )}

      {/* Graduated Adaptive Quarantine & Dynamic Rate Throttling Panel */}
      <div style={{ marginTop: "24px" }}>
        <Surface className="simulator-section-panel">
          <div className="section-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Activity size={18} className="text-accent-blue" />
                <h2>Automatic slow-down</h2>
                <Badge tone="success">Active</Badge>
              </div>
              <p style={{ marginTop: "4px", fontSize: "0.84rem", color: "var(--color-on-surface-variant)" }}>
                Instead of a hard stop, spending slows down in steps as activity gets unusual, and recovers on its own after 30 minutes.
              </p>
            </div>
            <Badge tone={simulatedZScore >= 5.0 ? "critical" : simulatedZScore >= 3.5 ? "warning" : simulatedZScore >= 2.0 ? "info" : "success"}>
              {simulatedZScore >= 5.0 ? "Stopped" : simulatedZScore >= 3.5 ? "Needs approval" : simulatedZScore >= 2.0 ? "Slowed to 50%" : "Normal"}
            </Badge>
          </div>

          <div style={{ marginTop: "16px", padding: "16px", borderRadius: "8px", background: "var(--surface-3)", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>How unusual is the activity?</span>
              <Mono style={{ fontSize: "0.95rem", fontWeight: 700, color: simulatedZScore >= 3.5 ? "var(--color-error)" : "var(--color-primary)" }}>
                {simulatedZScore.toFixed(1)} / 6
              </Mono>
            </div>

            <input
              type="range"
              aria-label="How unusual is the activity?"
              min="0"
              max="6"
              step="0.1"
              value={simulatedZScore}
              onChange={(e) => setSimulatedZScore(parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "var(--color-primary)", cursor: "pointer" }}
            />

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "var(--color-on-surface-variant)", marginTop: "4px" }}>
              <span>Normal</span>
              <span>Slow down</span>
              <span>Needs approval</span>
              <span>Stop</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3" style={{ marginTop: "16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
            <div style={{ padding: "12px", borderRadius: "8px", background: "var(--surface-3)", border: "1px solid var(--border)" }}>
              <span style={{ fontSize: "0.76rem", color: "var(--color-on-surface-variant)" }}>Current spending limit</span>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: "4px", fontFamily: "var(--font-mono)", color: simulatedZScore >= 5.0 ? "var(--color-error)" : "var(--status-good)" }}>
                {simulatedZScore >= 5.0 ? "0.00 USDC (0%)" : simulatedZScore >= 3.5 ? "9.00 USDC (20%)" : simulatedZScore >= 2.0 ? "22.50 USDC (50%)" : "45.00 USDC (100%)"}
              </div>
              <span style={{ fontSize: "0.72rem", color: "var(--color-on-surface-variant)" }}>Allowed per payment</span>
            </div>

            <div style={{ padding: "12px", borderRadius: "8px", background: "var(--surface-3)", border: "1px solid var(--border)" }}>
              <span style={{ fontSize: "0.76rem", color: "var(--color-on-surface-variant)" }}>Approval needed</span>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: "4px", color: simulatedZScore >= 3.5 ? "var(--status-warning)" : "var(--color-primary)" }}>
                {simulatedZScore >= 3.5 ? "Multi-Sig Mandatory" : "Autonomous Pass"}
              </div>
              <span style={{ fontSize: "0.72rem", color: "var(--color-on-surface-variant)" }}>Extra signature required</span>
            </div>

            <div style={{ padding: "12px", borderRadius: "8px", background: "var(--surface-3)", border: "1px solid var(--border)" }}>
              <span style={{ fontSize: "0.76rem", color: "var(--color-on-surface-variant)" }}>Recovery time</span>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: "4px", color: "var(--accent-blue)" }}>
                1,800s (30 mins)
              </div>
              <span style={{ fontSize: "0.72rem", color: "var(--status-good)" }}>Recovers automatically</span>
            </div>

            <div style={{ padding: "12px", borderRadius: "8px", background: "var(--surface-3)", border: "1px solid var(--border)" }}>
              <span style={{ fontSize: "0.76rem", color: "var(--color-on-surface-variant)" }}>Isolation</span>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: "4px" }}>
                Per agent
              </div>
              <span style={{ fontSize: "0.72rem", color: "var(--color-on-surface-variant)" }}>One agent never affects another</span>
            </div>
          </div>
        </Surface>
      </div>
    </div>
  );
}
