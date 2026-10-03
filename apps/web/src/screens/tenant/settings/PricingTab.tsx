import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { type CalculateToolCallRequest, type ModelRateOverride, type PricingModelType, type ToolRateOverride, type VolumeTier, useCalculateSpend, useTenantPricingModel, useUpdateTenantPricingModel, toUserFacingError } from "../../../api";
import { Badge, Button, Mono, Select, Surface, SkeletonRows } from "../../../design-system";
import { type Identity } from "../../../identity";
import { canManagePricing } from "./shared";
import { formatMicroUsd, formatNumber, formatPercent } from "../../../format";

export function PricingTab({ identity }: { identity: Identity }) {
  const pricingQuery = useTenantPricingModel(Boolean(identity.authenticated));
  const updatePricing = useUpdateTenantPricingModel(() => {
    pricingQuery.refetch();
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 4000);
  });
  const calculateSpend = useCalculateSpend();

  const [modelType, setModelType] = useState<PricingModelType>("flat_discount");
  const [discountPercent, setDiscountPercent] = useState<string>("0");
  const [ptuCapacityM, setPtuCapacityM] = useState<string>("0");
  const [tokenCapM, setTokenCapM] = useState<string>("0");
  const [perCallFeeDollars, setPerCallFeeDollars] = useState<string>("0");
  const [volumeTiers, setVolumeTiers] = useState<VolumeTier[]>([]);
  const [customRates, setCustomRates] = useState<
    Record<string, { input: string; output: string; cacheRead: string; cacheWrite: string }>
  >({});
  const [toolCustomRates, setToolCustomRates] = useState<Record<string, { costPerCall: string }>>({});

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Simulator state
  const [simModel, setSimModel] = useState<string>("claude-3-7-sonnet");
  const [simInputTokens, setSimInputTokens] = useState<string>("150000");
  const [simOutputTokens, setSimOutputTokens] = useState<string>("25000");
  const [simCacheReadTokens, setSimCacheReadTokens] = useState<string>("50000");
  const [simCacheWriteTokens, setSimCacheWriteTokens] = useState<string>("10000");
  const [simIsBatch, setSimIsBatch] = useState<boolean>(false);
  const [simToolCounts, setSimToolCounts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (pricingQuery.data?.pricing) {
      const p = pricingQuery.data.pricing;
      setModelType(p.modelType);
      setDiscountPercent((p.discountBps / 100).toString());
      setPtuCapacityM((p.ptuCapacityTokens / 1_000_000).toString());
      setTokenCapM(p.tokenCapTokens ? (p.tokenCapTokens / 1_000_000).toString() : "0");
      setPerCallFeeDollars(p.perCallFeeMicroDollars ? (p.perCallFeeMicroDollars / 1_000_000).toString() : "0");
      setVolumeTiers(p.volumeTiers ?? []);

      const rates: Record<string, { input: string; output: string; cacheRead: string; cacheWrite: string }> = {};
      for (const [key, val] of Object.entries(p.customRates ?? {})) {
        rates[key] = {
          input: (val.inputPerMMicroDollars / 1_000_000).toString(),
          output: (val.outputPerMMicroDollars / 1_000_000).toString(),
          cacheRead: val.cacheReadPerMMicroDollars !== undefined ? (val.cacheReadPerMMicroDollars / 1_000_000).toString() : "",
          cacheWrite: val.cacheWritePerMMicroDollars !== undefined ? (val.cacheWritePerMMicroDollars / 1_000_000).toString() : "",
        };
      }
      setCustomRates(rates);

      const tools: Record<string, { costPerCall: string }> = {};
      for (const [key, val] of Object.entries(p.toolCustomRates ?? {})) {
        tools[key] = {
          costPerCall: (val.costPerCallMicroDollars / 1_000_000).toString(),
        };
      }
      setToolCustomRates(tools);
    }
  }, [pricingQuery.data]);

  const handleSave = () => {
    setSaveError(null);
    const discountBps = Math.min(10000, Math.max(0, Math.round(parseFloat(discountPercent || "0") * 100)));
    const ptuCapacityTokens = Math.max(0, Math.round(parseFloat(ptuCapacityM || "0") * 1_000_000));
    const tokenCapTokens = Math.max(0, Math.round(parseFloat(tokenCapM || "0") * 1_000_000));
    const perCallFeeMicroDollars = Math.max(0, Math.round(parseFloat(perCallFeeDollars || "0") * 1_000_000));

    const processedRates: Record<string, ModelRateOverride> = {};
    for (const [key, val] of Object.entries(customRates)) {
      if (val.input || val.output || val.cacheRead || val.cacheWrite) {
        processedRates[key] = {
          inputPerMMicroDollars: Math.round(parseFloat(val.input || "0") * 1_000_000),
          outputPerMMicroDollars: Math.round(parseFloat(val.output || "0") * 1_000_000),
          ...(val.cacheRead ? { cacheReadPerMMicroDollars: Math.round(parseFloat(val.cacheRead) * 1_000_000) } : {}),
          ...(val.cacheWrite ? { cacheWritePerMMicroDollars: Math.round(parseFloat(val.cacheWrite) * 1_000_000) } : {}),
        };
      }
    }

    const processedToolRates: Record<string, ToolRateOverride> = {};
    for (const [key, val] of Object.entries(toolCustomRates)) {
      if (val.costPerCall) {
        processedToolRates[key] = {
          costPerCallMicroDollars: Math.round(parseFloat(val.costPerCall) * 1_000_000),
        };
      }
    }

    updatePricing.mutate(
      {
        modelType,
        discountBps,
        volumeTiers,
        ptuCapacityTokens,
        tokenCapTokens,
        perCallFeeMicroDollars,
        customRates: processedRates,
        toolCustomRates: processedToolRates,
      },
      {
        onError: (err) => setSaveError(toUserFacingError(err, "Failed to update pricing model.")),
      },
    );
  };

  const handleRunSimulation = () => {
    const toolCalls: CalculateToolCallRequest[] = [];
    for (const [toolId, countStr] of Object.entries(simToolCounts)) {
      const count = parseInt(countStr || "0", 10);
      if (count > 0) {
        toolCalls.push({ toolId, count });
      }
    }

    calculateSpend.mutate({
      modelName: simModel,
      inputTokens: parseInt(simInputTokens || "0", 10),
      outputTokens: parseInt(simOutputTokens || "0", 10),
      cacheReadTokens: parseInt(simCacheReadTokens || "0", 10),
      cacheCreationTokens: parseInt(simCacheWriteTokens || "0", 10),
      isBatch: simIsBatch,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    });
  };

  const isEditable = canManagePricing(identity.role);
  const catalog = pricingQuery.data?.catalog ?? [];
  const toolCatalog = pricingQuery.data?.toolCatalog ?? [];
  const currentPricing = pricingQuery.data?.pricing;

  return (
    <>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>AI usage pricing</h2>
            <p>Set how much this AI usage costs your organization.</p>
          </div>
        </div>

        {pricingQuery.isLoading ? (
          <SkeletonRows rows={4} label="Loading your pricing plan" />
        ) : (
          <div className="stack" style={{ gap: "var(--space-md)" }}>
            {/* Real-Time Status Metric Strip */}
            <div className="finops-stat-grid">
              <div className="finops-stat-card">
                <span className="finops-stat-label">Tokens used this month</span>
                <span className="finops-stat-value">
                  {formatNumber(currentPricing?.monthlyTokensConsumed ?? 0)} <small style={{ fontSize: "0.75rem", fontWeight: 400 }}>tokens</small>
                </span>
                <span className="finops-stat-sub">Running total this month</span>
              </div>
              <div className="finops-stat-card">
                <span className="finops-stat-label">Pricing plan</span>
                <div style={{ marginTop: "2px" }}>
                  <Badge tone="info">
                    {currentPricing ? currentPricing.modelType.replace(/_/g, " ").toUpperCase() : "FLAT DISCOUNT"}
                  </Badge>
                </div>
                <span className="finops-stat-sub">Current plan type</span>
              </div>
              <div className="finops-stat-card">
                <span className="finops-stat-label">Monthly usage cap</span>
                <span className="finops-stat-value">
                  {currentPricing?.tokenCapTokens != null && currentPricing.tokenCapTokens > 0
                    ? `${formatNumber(currentPricing.tokenCapTokens / 1_000_000, { maximumFractionDigits: 2 })}M`
                    : "Unlimited"}
                </span>
                <span className="finops-stat-sub">Maximum tokens per month</span>
              </div>
              <div className="finops-stat-card">
                <span className="finops-stat-label">Current rate</span>
                <span className="finops-stat-value" style={{ fontSize: "1rem" }}>
                  {modelType === "flat_discount" && `${discountPercent}% off`}
                  {modelType === "batch_discount" && `50% batch + ${discountPercent}%`}
                  {modelType === "committed_ptu" && `${ptuCapacityM}M prepaid`}
                  {modelType === "per_unit_request" && `$${perCallFeeDollars} / request`}
                  {modelType === "hybrid_commit_volume" && `${ptuCapacityM}M prepaid + tiers`}
                  {modelType === "tiered_volume" && `${volumeTiers.length} volume tiers`}
                </span>
                <span className="finops-stat-sub">Summary</span>
              </div>
            </div>

            {/* Contract Model Configuration Layout */}
            <div className="finops-config-layout">
              {/* Left Column: Contract Pricing Model */}
              <div className="finops-config-box">
                <div className="finops-field-group">
                  <Select
                    label="Pricing plan"
                    value={modelType}
                    disabled={!isEditable}
                    onChange={(val) => setModelType(val as PricingModelType)}
                    options={[
                      { value: "flat_discount", label: "Flat discount", detail: "A fixed % off the standard price" },
                      { value: "tiered_volume", label: "Volume discounts", detail: "Bigger discounts as usage grows" },
                      { value: "committed_ptu", label: "Prepaid capacity", detail: "Pay upfront, then overage" },
                      { value: "batch_discount", label: "Batch discount", detail: "50% off for non-urgent requests" },
                      { value: "per_unit_request", label: "Per-request fee", detail: "A flat fee for every request" },
                      { value: "hybrid_commit_volume", label: "Prepaid + volume discounts", detail: "Combines prepaid capacity with volume discounts" },
                    ]}
                  />
                </div>

                {(modelType === "flat_discount" || modelType === "batch_discount") && (
                  <div className="finops-field-group">
                    <label className="finops-label" htmlFor="discount-input">
                      <span>Discount</span>
                      <span className="finops-label-hint">% off the standard price</span>
                    </label>
                    <div className="finops-input-wrapper">
                      <input
                        id="discount-input"
                        className="finops-input has-suffix"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        disabled={!isEditable}
                        value={discountPercent}
                        onChange={(e) => setDiscountPercent(e.target.value)}
                      />
                      <span className="finops-input-suffix">%</span>
                    </div>
                    {modelType === "batch_discount" && (
                      <div style={{ display: "flex", gap: "8px", alignItems: "center", padding: "8px 12px", borderRadius: "8px", background: "var(--primary-soft)", border: "1px solid var(--primary)", marginTop: "4px" }}>
                        <Zap size={15} style={{ color: "var(--primary)", flexShrink: 0 }} />
                        <span style={{ fontSize: "0.75rem", color: "var(--on-surface)" }}>
                          Batch requests automatically get 50% off, on top of this discount.
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {(modelType === "committed_ptu" || modelType === "hybrid_commit_volume") && (
                  <div className="finops-field-group">
                    <label className="finops-label" htmlFor="ptu-input">
                      <span>Prepaid monthly tokens</span>
                      <span className="finops-label-hint">Paid upfront, no extra cost until you exceed it</span>
                    </label>
                    <div className="finops-input-wrapper">
                      <input
                        id="ptu-input"
                        className="finops-input has-suffix"
                        type="number"
                        min="0"
                        step="1"
                        disabled={!isEditable}
                        value={ptuCapacityM}
                        onChange={(e) => setPtuCapacityM(e.target.value)}
                      />
                      <span className="finops-input-suffix">M Tokens</span>
                    </div>
                  </div>
                )}

                {modelType === "per_unit_request" && (
                  <div className="finops-field-group">
                    <label className="finops-label" htmlFor="toll-input">
                      <span>Fee per request</span>
                      <span className="finops-label-hint">Charged every time this is used</span>
                    </label>
                    <div className="finops-input-wrapper">
                      <span className="finops-input-prefix">$</span>
                      <input
                        id="toll-input"
                        className="finops-input has-prefix"
                        type="number"
                        min="0"
                        step="0.0001"
                        disabled={!isEditable}
                        value={perCallFeeDollars}
                        onChange={(e) => setPerCallFeeDollars(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Dual-Denomination Token Quota Cap */}
              <div className="finops-config-box">
                <div className="finops-field-group">
                  <label className="finops-label" htmlFor="token-cap-input">
                    <span>Monthly usage cap</span>
                    <span className="finops-label-hint">0 = Unlimited</span>
                  </label>
                  <div className="finops-input-wrapper">
                    <input
                      id="token-cap-input"
                      className="finops-input has-suffix"
                      type="number"
                      min="0"
                      step="1"
                      disabled={!isEditable}
                      value={tokenCapM}
                      onChange={(e) => setTokenCapM(e.target.value)}
                    />
                    <span className="finops-input-suffix">M Tokens</span>
                  </div>
                  <span className="finops-stat-sub" style={{ marginTop: "4px" }}>
                    Usage stops counting toward billing once this cap is hit.
                  </span>
                </div>
              </div>
            </div>

            {/* Volume Tiers Ladder Builder */}
            {(modelType === "tiered_volume" || modelType === "hybrid_commit_volume") && (
              <div className="finops-config-box">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>Volume discount tiers</span>
                    <p className="subtle" style={{ margin: "2px 0 0", fontSize: "0.78rem" }}>
                      Bigger discounts automatically apply as monthly usage grows.
                    </p>
                  </div>
                  {isEditable && (
                    <Button
                      variant="tonal"
                      onClick={() => setVolumeTiers([...volumeTiers, { minTokens: 10_000_000, discountBps: 1500 }])}
                    >
                      + Add tier
                    </Button>
                  )}
                </div>

                {volumeTiers.length === 0 ? (
                  <p className="subtle" style={{ fontSize: "0.82rem" }}>No tiers yet. The standard rate applies to all usage.</p>
                ) : (
                  <div className="stack" style={{ gap: "8px" }}>
                    {volumeTiers.map((tier, idx) => (
                      <div key={idx} style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
                        <div style={{ flex: "1 1 180px" }}>
                          <span className="finops-label" style={{ fontSize: "0.72rem", marginBottom: "4px" }}>Starting at (tokens/month)</span>
                          <input
                            className="finops-input"
                            type="number"
                            disabled={!isEditable}
                            value={tier.minTokens.toString()}
                            onChange={(e) => {
                              const updated = [...volumeTiers];
                              updated[idx] = { ...tier, minTokens: parseInt(e.target.value || "0", 10) };
                              setVolumeTiers(updated);
                            }}
                          />
                        </div>
                        <div style={{ flex: "1 1 140px" }}>
                          <span className="finops-label" style={{ fontSize: "0.72rem", marginBottom: "4px" }}>Discount (%)</span>
                          <div className="finops-input-wrapper">
                            <input
                              className="finops-input has-suffix"
                              type="number"
                              min="0"
                              max="100"
                              disabled={!isEditable}
                              value={(tier.discountBps / 100).toString()}
                              onChange={(e) => {
                                const updated = [...volumeTiers];
                                updated[idx] = { ...tier, discountBps: Math.round(parseFloat(e.target.value || "0") * 100) };
                                setVolumeTiers(updated);
                              }}
                            />
                            <span className="finops-input-suffix">%</span>
                          </div>
                        </div>
                        {isEditable && (
                          <div style={{ paddingTop: "20px" }}>
                            <Button
                              variant="text"
                              onClick={() => setVolumeTiers(volumeTiers.filter((_, i) => i !== idx))}
                            >
                              Remove
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {isEditable && (
              <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", marginTop: "var(--space-xs)" }}>
                <Button variant="filled" onClick={handleSave} disabled={updatePricing.isPending}>
                  {updatePricing.isPending ? "Saving…" : "Save pricing"}
                </Button>
                {saveSuccess && <span style={{ color: "var(--status-good)", fontSize: "0.85rem" }}>Pricing model updated successfully.</span>}
                {saveError && <span style={{ color: "var(--error)", fontSize: "0.85rem" }}>{saveError}</span>}
              </div>
            )}
          </div>
        )}
      </Surface>

      {/* Surface 2: Official Foundation Model Catalog Table */}
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Model pricing</h2>
            <p>Standard rates per 1M tokens. Add a custom rate if you've negotiated a different price.</p>
          </div>
        </div>

        <div className="finops-table-container">
          <table className="finops-table">
            <thead>
              <tr>
                <th>Model / Provider</th>
                <th className="text-right">Input / 1M</th>
                <th className="text-right">Output / 1M</th>
                <th className="text-right">Cache Read</th>
                <th className="text-right">Cache Write</th>
                <th className="text-center" style={{ minWidth: "340px" }}>Custom Rate Overrides ($/1M: In | Out | Read | Write)</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((entry) => {
                const override = customRates[entry.modelId] || { input: "", output: "", cacheRead: "", cacheWrite: "" };
                return (
                  <tr key={entry.modelId}>
                    <td>
                      <div className="finops-model-name">{entry.displayName}</div>
                      <div className="finops-model-meta">
                        <span className="finops-provider-tag">{entry.provider.toUpperCase()}</span>
                        <Mono>{entry.modelId}</Mono>
                      </div>
                    </td>
                    <td className="text-right">
                      <span className="finops-rate-pill">{formatMicroUsd(entry.inputPerMMicroDollars, 2)}</span>
                    </td>
                    <td className="text-right">
                      <span className="finops-rate-pill">{formatMicroUsd(entry.outputPerMMicroDollars, 2)}</span>
                    </td>
                    <td className="text-right">
                      <span className="finops-rate-pill" style={{ color: "var(--status-good)" }}>
                        {formatMicroUsd(entry.cacheReadPerMMicroDollars, 2)}
                      </span>
                    </td>
                    <td className="text-right">
                      <span className="finops-rate-pill">{formatMicroUsd(entry.cacheWritePerMMicroDollars, 2)}</span>
                    </td>
                    <td>
                      <div className="finops-override-grid">
                        <div className="finops-override-chip">
                          <span className="finops-override-tag">IN</span>
                          <div className="finops-override-field">
                            <span>$</span>
                            <input
                              type="number"
                              step="0.01"
                              placeholder={(entry.inputPerMMicroDollars / 1_000_000).toFixed(2)}
                              disabled={!isEditable}
                              value={override.input}
                              onChange={(e) => setCustomRates({ ...customRates, [entry.modelId]: { ...override, input: e.target.value } })}
                            />
                          </div>
                        </div>
                        <div className="finops-override-chip">
                          <span className="finops-override-tag">OUT</span>
                          <div className="finops-override-field">
                            <span>$</span>
                            <input
                              type="number"
                              step="0.01"
                              placeholder={(entry.outputPerMMicroDollars / 1_000_000).toFixed(2)}
                              disabled={!isEditable}
                              value={override.output}
                              onChange={(e) => setCustomRates({ ...customRates, [entry.modelId]: { ...override, output: e.target.value } })}
                            />
                          </div>
                        </div>
                        <div className="finops-override-chip">
                          <span className="finops-override-tag">READ</span>
                          <div className="finops-override-field">
                            <span>$</span>
                            <input
                              type="number"
                              step="0.01"
                              placeholder={(entry.cacheReadPerMMicroDollars / 1_000_000).toFixed(2)}
                              disabled={!isEditable}
                              value={override.cacheRead}
                              onChange={(e) => setCustomRates({ ...customRates, [entry.modelId]: { ...override, cacheRead: e.target.value } })}
                            />
                          </div>
                        </div>
                        <div className="finops-override-chip">
                          <span className="finops-override-tag">WRITE</span>
                          <div className="finops-override-field">
                            <span>$</span>
                            <input
                              type="number"
                              step="0.01"
                              placeholder={(entry.cacheWritePerMMicroDollars / 1_000_000).toFixed(2)}
                              disabled={!isEditable}
                              value={override.cacheWrite}
                              onChange={(e) => setCustomRates({ ...customRates, [entry.modelId]: { ...override, cacheWrite: e.target.value } })}
                            />
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Surface>

      {/* Surface 3: Per-Operation Tool & Service Rate Cards Table */}
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Tool & service pricing</h2>
            <p>Tools billed per use instead of per token, like search or code execution.</p>
          </div>
        </div>

        <div className="finops-table-container">
          <table className="finops-table">
            <thead>
              <tr>
                <th>Tool / Service & Provider</th>
                <th>Category</th>
                <th className="text-right">Official Base Rate</th>
                <th className="text-center" style={{ width: "240px" }}>Custom Negotiated Override ($ / call)</th>
              </tr>
            </thead>
            <tbody>
              {toolCatalog.map((tool) => {
                const override = toolCustomRates[tool.toolId] || { costPerCall: "" };
                return (
                  <tr key={tool.toolId}>
                    <td>
                      <div className="finops-model-name">{tool.displayName}</div>
                      <div className="finops-model-meta">
                        <span className="finops-provider-tag">{tool.provider}</span>
                        <Mono>{tool.toolId}</Mono>
                      </div>
                    </td>
                    <td>
                      <Badge tone={tool.category === "search" ? "info" : tool.category === "scraping" ? "warning" : "neutral"}>
                        {tool.category.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="text-right">
                      <span className="finops-rate-pill">{formatMicroUsd(tool.costPerCallMicroDollars, 4)} / call</span>
                    </td>
                    <td>
                      <div className="finops-input-wrapper" style={{ maxWidth: "200px", margin: "0 auto" }}>
                        <span className="finops-input-prefix">$</span>
                        <input
                          className="finops-input has-prefix"
                          type="number"
                          step="0.0001"
                          placeholder={(tool.costPerCallMicroDollars / 1_000_000).toFixed(4)}
                          disabled={!isEditable}
                          value={override.costPerCall}
                          onChange={(e) => setToolCustomRates({ ...toolCustomRates, [tool.toolId]: { costPerCall: e.target.value } })}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Surface>

      {/* Surface 4: Live Spend Simulator & FinOps Sandbox */}
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Estimate your cost</h2>
            <p>See what a request would cost under your current plan before you run it.</p>
          </div>
        </div>

        <div className="stack" style={{ gap: "var(--space-md)" }}>
          {/* Workload Target & Execution Mode */}
          <div className="finops-config-layout">
            <div className="finops-field-group">
              <Select
                label="Target Model"
                value={simModel}
                onChange={(val) => setSimModel(val)}
                options={catalog.map((m) => ({
                  value: m.modelId,
                  label: m.displayName,
                  detail: m.modelId,
                }))}
              />
            </div>

            <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px 14px", borderRadius: "10px", background: simIsBatch ? "var(--primary-soft)" : "var(--surface-sunken)", border: simIsBatch ? "1px solid var(--primary)" : "1px solid var(--outline-soft)", cursor: "pointer", transition: "all 0.15s ease" }}>
              <input
                type="checkbox"
                id="sim-batch-toggle"
                checked={simIsBatch}
                onChange={(e) => setSimIsBatch(e.target.checked)}
                style={{ width: "16px", height: "16px", accentColor: "var(--primary)", marginTop: "3px", cursor: "pointer" }}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--on-surface)" }}>
                  Batch mode (50% off)
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "2px" }}>
                  Get 50% off in exchange for results within 24 hours instead of instantly.
                </div>
              </div>
            </label>
          </div>

          {/* 4-Dimensional Token Compute Inputs */}
          <div>
            <span style={{ fontWeight: 600, fontSize: "0.88rem", display: "block", marginBottom: "8px" }}>
              Usage
            </span>
            <div className="finops-sim-grid">
              <div className="finops-sim-box">
                <label className="finops-label" htmlFor="sim-input">Input tokens</label>
                <input
                  id="sim-input"
                  className="finops-input"
                  type="number"
                  min="0"
                  value={simInputTokens}
                  onChange={(e) => setSimInputTokens(e.target.value)}
                />
                <span className="finops-stat-sub">What you send in</span>
              </div>
              <div className="finops-sim-box">
                <label className="finops-label" htmlFor="sim-output">Output tokens</label>
                <input
                  id="sim-output"
                  className="finops-input"
                  type="number"
                  min="0"
                  value={simOutputTokens}
                  onChange={(e) => setSimOutputTokens(e.target.value)}
                />
                <span className="finops-stat-sub">What comes back</span>
              </div>
              <div className="finops-sim-box">
                <label className="finops-label" htmlFor="sim-cache-read">Cache read tokens</label>
                <input
                  id="sim-cache-read"
                  className="finops-input"
                  type="number"
                  min="0"
                  value={simCacheReadTokens}
                  onChange={(e) => setSimCacheReadTokens(e.target.value)}
                />
                <span className="finops-stat-sub" style={{ color: "var(--status-good)" }}>Reused from cache</span>
              </div>
              <div className="finops-sim-box">
                <label className="finops-label" htmlFor="sim-cache-write">Cache write tokens</label>
                <input
                  id="sim-cache-write"
                  className="finops-input"
                  type="number"
                  min="0"
                  value={simCacheWriteTokens}
                  onChange={(e) => setSimCacheWriteTokens(e.target.value)}
                />
                <span className="finops-stat-sub">Newly cached</span>
              </div>
            </div>
          </div>

          {/* Tool Invocations Section */}
          {toolCatalog.length > 0 && (
            <div>
              <span style={{ fontWeight: 600, fontSize: "0.88rem", display: "block", marginBottom: "8px" }}>
                Tool usage
              </span>
              <div className="finops-sim-grid">
                {toolCatalog.map((tool) => (
                  <div key={tool.toolId} className="finops-sim-box">
                    <label className="finops-label" htmlFor={`tool-sim-${tool.toolId}`}>{tool.displayName}</label>
                    <input
                      id={`tool-sim-${tool.toolId}`}
                      className="finops-input"
                      type="number"
                      min="0"
                      value={simToolCounts[tool.toolId] || "0"}
                      onChange={(e) => setSimToolCounts({ ...simToolCounts, [tool.toolId]: e.target.value })}
                    />
                    <span className="finops-stat-sub">{formatMicroUsd(tool.costPerCallMicroDollars, 4)} / call</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
            <Button variant="filled" onClick={handleRunSimulation} disabled={calculateSpend.isPending}>
              {calculateSpend.isPending ? "Calculating…" : "Calculate cost"}
            </Button>
          </div>

          {calculateSpend.data && (
            <div style={{ padding: "16px", border: "1px solid var(--outline-soft)", borderRadius: "12px", background: "var(--surface-container)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <h3 style={{ fontSize: "0.95rem", margin: 0 }}>Estimated cost</h3>
                <Badge tone={calculateSpend.data.effectiveDiscountBps > 0 ? "success" : "neutral"}>
                  {formatPercent(calculateSpend.data.effectiveDiscountBps / 100, 1)} off
                </Badge>
              </div>

              <div className="finops-stat-grid" style={{ marginBottom: 0 }}>
                <div className="finops-stat-card">
                  <span className="finops-stat-label">Total tokens</span>
                  <span className="finops-stat-value">{formatNumber(calculateSpend.data.totalTokens)}</span>
                  <span className="finops-stat-sub">Input + output + cache</span>
                </div>
                <div className="finops-stat-card">
                  <span className="finops-stat-label">Standard price</span>
                  <span className="finops-stat-value">{formatMicroUsd(calculateSpend.data.nominalListCostMicroDollars, 4)}</span>
                  <span className="finops-stat-sub">Before your discount</span>
                </div>
                <div className="finops-stat-card">
                  <span className="finops-stat-label">Your price</span>
                  <span className="finops-stat-value" style={{ color: "var(--primary)" }}>
                    {formatMicroUsd(calculateSpend.data.effectiveCostMicroDollars, 4)}
                  </span>
                  <span className="finops-stat-sub">With your discount</span>
                </div>
                {calculateSpend.data.toolCostMicroDollars != null && calculateSpend.data.toolCostMicroDollars > 0 && (
                  <div className="finops-stat-card">
                    <span className="finops-stat-label">Tool costs</span>
                    <span className="finops-stat-value">
                      {formatMicroUsd(calculateSpend.data.toolCostMicroDollars, 4)}
                    </span>
                    <span className="finops-stat-sub">From tools used</span>
                  </div>
                )}
                {calculateSpend.data.toolCostMicroDollars != null && calculateSpend.data.toolCostMicroDollars > 0 && (
                  <div className="finops-stat-card">
                    <span className="finops-stat-label">Total</span>
                    <span className="finops-stat-value" style={{ color: "var(--primary)" }}>
                      {formatMicroUsd(calculateSpend.data.effectiveCostMicroDollars + calculateSpend.data.toolCostMicroDollars, 4)}
                    </span>
                    <span className="finops-stat-sub">Tokens + tools</span>
                  </div>
                )}
              </div>

              {calculateSpend.data.contractModel === "committed_ptu" && (
                <div style={{ marginTop: "12px", padding: "8px 12px", borderRadius: "8px", background: "var(--surface-sunken)", fontSize: "0.8rem", color: "var(--muted)" }}>
                  Prepaid tokens used: <strong style={{ color: "var(--on-surface)" }}>{formatNumber(calculateSpend.data.ptuCapacityApplied)} tokens</strong> at no extra cost.
                </div>
              )}
              {calculateSpend.data.contractModel === "hybrid_commit_volume" && (
                <div style={{ marginTop: "12px", padding: "8px 12px", borderRadius: "8px", background: "var(--surface-sunken)", fontSize: "0.8rem", color: "var(--muted)" }}>
                  Prepaid tokens applied: <strong style={{ color: "var(--on-surface)" }}>{formatNumber(calculateSpend.data.ptuCapacityApplied)} tokens</strong> before volume discounts.
                </div>
              )}
            </div>
          )}
        </div>
      </Surface>
    </>
  );
}
