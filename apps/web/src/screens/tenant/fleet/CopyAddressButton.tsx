import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Mono, truncateMiddle } from "../../../design-system";

export function CopyAddressButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="agent-cell-wrapper">
      <Mono>{truncateMiddle(address, 10, 6)}</Mono>
      <button
        type="button"
        className={`table-copy-btn ${copied ? "copied-active" : ""}`}
        onClick={copy}
        title={copied ? "Copied!" : "Copy address to clipboard"}
        aria-label="Copy address"
      >
        {copied ? (
          <span className="copied-pill-text">
            <Check size={11} className="copy-success" />
            <span>Copied</span>
          </span>
        ) : (
          <Copy size={13} />
        )}
      </button>
    </div>
  );
}
