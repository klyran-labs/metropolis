import { ShieldCheck, AlertOctagon, Calculator } from "lucide-react";
import { Badge, Select, TextField } from "../../../design-system";
import { reasonCodeLabel } from "../../../copy";
import type { DryRunVerdict } from "./utils";

export function DryRunPanel({ verdict, amount, onAmountChange, merchant, onMerchantChange }: {
  verdict: DryRunVerdict;
  amount: string;
  onAmountChange: (value: string) => void;
  merchant: string;
  onMerchantChange: (value: string) => void;
}) {
  return (
    <div className="policy-dryrun-section">
      <div className="policy-dryrun-header">
        <Calculator size={18} />
        <span>Test before you publish</span>
        <Badge tone={verdict.allowed ? "success" : "critical"}>
          {verdict.allowed ? "Would go through" : "Would be blocked"}
        </Badge>
      </div>
      <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
        Try a sample payment against these settings before you publish them.
      </p>
      <div className="policy-dryrun-inputs">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <TextField
            label="Amount (USDC)"
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
            placeholder="15.00"
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Select
            label="Recipient"
            value={merchant}
            onChange={onMerchantChange}
            options={[
              { value: "whitelisted", label: "Approved merchant" },
              { value: "unwhitelisted", label: "Unapproved address" },
            ]}
          />
        </div>
      </div>

      <div className={`policy-verdict-banner ${verdict.allowed ? "verdict-allowed" : "verdict-denied"}`}>
        {verdict.allowed ? (
          <ShieldCheck size={20} color="var(--status-success, #2ed573)" style={{ flexShrink: 0, marginTop: 2 }} />
        ) : (
          <AlertOctagon size={20} color="var(--status-critical, #ff4757)" style={{ flexShrink: 0, marginTop: 2 }} />
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong style={{ fontSize: "0.88rem" }}>
              {reasonCodeLabel(verdict.title)}
            </strong>
          </div>
          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--on-surface-secondary)" }}>
            {verdict.description}
          </p>
          <small style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
            {verdict.remediation}
          </small>
        </div>
      </div>
    </div>
  );
}
