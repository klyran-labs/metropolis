import { ShieldCheck, Code2 } from "lucide-react";
import { type CalldataInspectionResponse } from "../../../api";
import { Badge, Button, Mono, TextField } from "../../../design-system";
export function TransactionInspector({ value, onChange, onInspect, isInspecting, result }: {
  value: string;
  onChange: (value: string) => void;
  onInspect: () => void;
  isInspecting: boolean;
  result: CalldataInspectionResponse | null;
}) {
  return (
    <div className="policy-canary-section" style={{ marginTop: "16px" }}>
      <div className="policy-canary-header">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Code2 size={18} />
          <span style={{ fontWeight: 700, fontSize: "0.92rem" }}>Transaction details</span>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--muted)" }}>
        Paste a transaction's raw data to see what it actually does before approving it.
      </p>

      <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <div>
          <label style={{ fontSize: "0.76rem", color: "var(--muted)", marginBottom: "4px", display: "block" }}>
            Transaction data
          </label>
          <TextField
            label=""
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0xa9059cbb..."
          />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Button
            type="button"
            variant="tonal"
            onClick={onInspect}
            disabled={isInspecting || !value.trim()}
          >
            <ShieldCheck size={14} style={{ marginRight: 6 }} />
            <span>{isInspecting ? "Checking…" : "Check this transaction"}</span>
          </Button>
        </div>

        {result && (
          <div style={{ padding: "12px", borderRadius: "8px", background: "var(--surface-3)", border: "1px solid var(--border)", marginTop: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>{result.function_name}</span>
              <Badge tone={result.risk_level === "critical" ? "critical" : result.risk_level === "elevated" ? "warning" : "success"}>
                {result.risk_level === "critical" ? "High risk" : result.risk_level === "elevated" ? "Some risk" : "Low risk"}
              </Badge>
            </div>

            <div style={{ fontSize: "0.82rem", padding: "8px", borderRadius: "6px", background: "var(--surface-sunken)", marginBottom: "8px" }}>
              <span>{result.clear_signing_summary}</span>
            </div>

            {result.fields.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.76rem" }}>
                {result.fields.map((f, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", borderBottom: i < result.fields.length - 1 ? "1px solid var(--outline-soft)" : "none", padding: "4px 0" }}>
                    <span style={{ color: "var(--muted)" }}>{f.name}</span>
                    <Mono style={{ fontSize: "0.72rem" }}>{f.value}</Mono>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
