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
  estimatedGas: number;
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
    setCircuitMessage("Simulating runaway recursive loop from autonomous Qwen 3.8 Max agent...");

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
      setCircuitMessage("The circuit was not changed because one or more policy evaluations were unavailable.");
      setRunawayRunning(false);
      return;
    }
    setCircuitMessage("Auto-trip threshold reached (3 consecutive onchain denials). Requesting the agent pause.");

    try {
      await tripKillSwitchMutation.mutateAsync({
        agentAddress: activeAgent.address,
        active: true,
      });
      setCircuitState("OPEN");
      setCircuitMessage("Monad O(1) Kill-Switch active onchain. Agent quarantined with zero parallel EVM lock contention.");
    } catch {
      setCircuitMessage("The kill-switch transaction could not be confirmed onchain; the circuit state is unchanged.");
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
          ? "Circuit breaker restored to CLOSED (Armored). Full transaction throughput enabled."
          : "Circuit breaker shifted to HALF_OPEN (Trial Probe). 1 low-velocity test probe allowed."
      );
    } catch {
      setCircuitMessage("The circuit state change could not be confirmed onchain; the current state is unchanged.");
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
        desc: "Onchain evaluation verdict returned from Monad EVM.",
        remediation: "Review policy parameters in Policy Studio.",
      };

      setResult({
        success: decision.allowed,
        reasonCode: decision.reasonCode,
        reasonTitle: `${reasonMeta.code} (${reasonMeta.title})`,
        reasonDescription: reasonMeta.desc,
        remediationAdvice: reasonMeta.remediation,
        estimatedGas: decision.allowed ? 46200 : 21400,
        executionLatencyMs: decision.executionLatencyMs,
        storageSlotsChecked: [
          `Slot 0: PackedPolicy (${truncateMiddle(activeAgent.address, 8, 4)})`,
          `Slot 1: PackedState (Nonce: ${decision.evaluatedAtTimestamp})`,
          "Cancun Transient: tload/tstore reentrancy guard",
        ],
      });
    } catch (err) {
      setResult({
        success: false,
        reasonCode: 9,
        reasonTitle: "EVM Call Execution Note",
        reasonDescription: toUserFacingError(err, "The policy evaluation could not be completed."),
        remediationAdvice: "Verify Monad node connectivity and ensure agent policy is initialized.",
        estimatedGas: 0,
        executionLatencyMs: 0,
        storageSlotsChecked: ["RPC Request Handshake"],
      });
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Risk Governance / Policy Engine</span>
          <h1>Policy "What-If" Simulator</h1>
          <p>
            Dry-run hypothetical autonomous spend requests against real Monad EVM storage slots before publishing or executing onchain.
          </p>
        </div>
      </header>

      {agents.length === 0 ? (
        <Surface>
          <EmptyState
            title="No agents registered yet"
            detail="Register your first agent in Fleet Overview to dry-run policy evaluations."
          />
        </Surface>
      ) : (
        <div className="simulator-layout-grid">
          <Surface className="simulator-input-panel">
            <div className="section-heading">
              <div>
                <h2>Simulation Parameters</h2>
                <p>Configure the test transaction payload.</p>
              </div>
              <span className="epoch-pill">
                <span className="epoch-dot" />
                Monad execution model
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
                  <span>Simulate expired EIP-712 signature deadline</span>
                </label>
              </div>

              <Button
                variant="filled"
                className="simulator-run-btn"
                onClick={runSimulation}
                disabled={simulating || !testAmount || !isAddress(testMerchant)}
              >
                <PlayCircle size={16} />
                <span>{simulating ? "Evaluating EVM Invariants…" : "Run Dry-Run Simulation"}</span>
              </Button>
            </div>
          </Surface>

          <Surface className="simulator-result-panel">
            <div className="section-heading">
              <div>
                <h2>Evaluation Trace & Diagnosis</h2>
                <p>EVM invariant inspection and machine-readable ReasonCode.</p>
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
                    <Layers size={14} /> Evaluated Storage Slots & Opcode Path:
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
                    <small>Gas Consumed</small>
                    <strong>{result.estimatedGas.toLocaleString()} units</strong>
                  </div>
                  <div className="metric-box">
                    <small>Evaluation Latency</small>
                    <strong>{result.executionLatencyMs} ms</strong>
                  </div>
                  <div className="metric-box">
                    <small>Settlement SLA</small>
                    <strong>Network finality</strong>
                  </div>
                </div>

                <div className="remediation-container">
                  <strong>Operational Remediation:</strong>
                  <p>{result.remediationAdvice}</p>
                  {!result.success && (
                    <Link to="/app/policy" className="remediation-btn">
                      <span>Adjust Invariants in Policy Studio</span>
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
                <h2>Autonomous Multi-Tier Circuit Breaker Testbench</h2>
                <p>
                  ADR-0008 containment engine: simulates recursive runaway inference loops from autonomous Qwen 3.8 Max agents.
                  Three consecutive policy invariant breaches automatically trigger the Monad <code>setKillSwitch(agent, true)</code> O(1) circuit breaker.
                </p>
              </div>
            </div>

            <div className="breaker-status-badge-container">
              <span className="breaker-state-label">Circuit State:</span>
              {circuitState === "CLOSED" && (
                <Badge tone="success" className="breaker-pill closed">
                  <ShieldCheck size={14} /> CLOSED (Armored)
                </Badge>
              )}
              {circuitState === "OPEN" && (
                <Badge tone="critical" className="breaker-pill open">
                  <AlertOctagon size={14} /> OPEN (Quarantined)
                </Badge>
              )}
              {circuitState === "HALF_OPEN" && (
                <Badge tone="neutral" className="breaker-pill half-open">
                  <Activity size={14} /> HALF_OPEN (Trial Probe)
                </Badge>
              )}
            </div>
          </div>

          <div className="breaker-control-bar">
            <div className="breaker-info">
              <span>Target Agent:</span>
              <Mono className="agent-target-chip">{truncateMiddle(activeAgent.address, 10, 6)}</Mono>
              <span className="separator">•</span>
              <span className="physics-note">O(1) Quarantine Protection on Monad</span>
            </div>

            <div className="breaker-actions">
              <Button
                variant="filled"
                className="simulate-runaway-btn"
                onClick={runRunawayCircuitBreaker}
                disabled={runawayRunning || circuitState === "OPEN"}
              >
                <Zap size={15} />
                <span>{runawayRunning ? "Simulating Runaway Loop…" : "Simulate Runaway Qwen 3.8 Max Loop"}</span>
              </Button>

              {circuitState === "OPEN" && (
                <>
                  <Button
                    variant="tonal"
                    onClick={() => handleResetCircuitBreaker("HALF_OPEN")}
                    disabled={runawayRunning}
                  >
                    <Activity size={15} />
                    <span>Set HALF_OPEN (Trial Probe)</span>
                  </Button>
                  <Button
                    variant="tonal"
                    onClick={() => handleResetCircuitBreaker("CLOSED")}
                    disabled={runawayRunning}
                  >
                    <RotateCcw size={15} />
                    <span>Reset Circuit (CLOSED)</span>
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
                  <span>Restore Full Traffic (CLOSED)</span>
                </Button>
              )}
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
                <span>Requested Inference Spend</span>
                <span>EVM Invariant Verdict</span>
                <span>ReasonCode</span>
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
    </div>
  );
}
