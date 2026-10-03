import { Scale } from "lucide-react";
import { Badge, Mono } from "../../../design-system";
import type { PolicyDiffRow } from "./utils";

export function PolicyDiffTable({ diffs }: { diffs: PolicyDiffRow[] }) {
  if (diffs.length === 0) return null;
  return (
    <div className="policy-diff-section">
      <div className="policy-dryrun-header">
        <Scale size={18} />
        <span>What's changing</span>
        <Badge tone="info">{diffs.length} {diffs.length === 1 ? "change" : "changes"}</Badge>
      </div>
      <table className="policy-diff-table">
        <thead>
          <tr>
            <th>Setting</th>
            <th>Current</th>
            <th>New</th>
            <th>Change</th>
            <th>Risk</th>
          </tr>
        </thead>
        <tbody>
          {diffs.map((d) => (
            <tr key={d.param}>
              <td><strong>{d.param}</strong></td>
              <td><Mono>{d.current}</Mono></td>
              <td><Mono>{d.draftVal}</Mono></td>
              <td>
                <Badge tone={d.deltaText.startsWith("+") ? "warning" : "neutral"}>
                  {d.deltaText}
                </Badge>
              </td>
              <td>
                <Badge tone={d.risk === "high" ? "critical" : d.risk === "medium" ? "warning" : "success"}>
                  {d.risk.toUpperCase()}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
