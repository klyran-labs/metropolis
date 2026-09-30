import { useEffect } from "react";
import { Keyboard, X, Command, CornerDownLeft, ShieldAlert } from "lucide-react";
import { Badge } from "../design-system";

export interface ShortcutGroup {
  category: string;
  items: {
    keys: string[];
    label: string;
    detail?: string;
  }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    category: "Global & Navigation",
    items: [
      {
        keys: ["⌘", "K"],
        label: "Command Palette & Search",
        detail: "Switch screens, search agents, trigger rapid workflows",
      },
      {
        keys: ["?"],
        label: "Keyboard Shortcuts Legend",
        detail: "Display this comprehensive hotkey reference",
      },
      {
        keys: ["Esc"],
        label: "Close Modal / Drawer",
        detail: "Dismiss any active dialog, drawer, or palette",
      },
    ],
  },
  {
    category: "Rapid Screen Jumps",
    items: [
      {
        keys: ["G", "F"],
        label: "Fleet Overview",
        detail: "Monitor autonomous agent statuses and spend velocities",
      },
      {
        keys: ["G", "P"],
        label: "Policy Studio",
        detail: "Configure spend limits, velocity caps, and invariants",
      },
      {
        keys: ["G", "Q"],
        label: "Quorum Approvals",
        detail: "Inspect multi-operator dual-control threshold requests",
      },
      {
        keys: ["G", "M"],
        label: "Merchant Directory",
        detail: "Review AI inference vendors and payment endpoints",
      },
      {
        keys: ["G", "T"],
        label: "Activity Trace",
        detail: "Stream real-time Monad settlement telemetry",
      },
      {
        keys: ["G", "S"],
        label: "Testbench Simulator",
        detail: "Run adversarial risk scenarios and policy evaluations",
      },
    ],
  },
  {
    category: "Fleet Operations & Controls",
    items: [
      {
        keys: ["P"],
        label: "Provision Autonomous Agent",
        detail: "Open the 4-step wizard to deploy an agent and keypair",
      },
      {
        keys: ["Space"],
        label: "Trip / Reset Kill-Switch",
        detail: "Instantly halt or resume agent execution in inspector",
      },
      {
        keys: ["↵"],
        label: "Confirm Action",
        detail: "Execute default button or primary form submission",
      },
    ],
  },
];

export function KeyboardShortcutsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-modal-header">
          <div className="shortcuts-modal-title-row">
            <div className="shortcuts-icon-pill">
              <Keyboard size={18} />
            </div>
            <div>
              <h2 id="shortcuts-dialog-title" className="shortcuts-modal-heading">
                Keyboard Shortcuts
              </h2>
              <p className="shortcuts-modal-subheading">
                High-velocity hotkeys for institutional agent fleet operations
              </p>
            </div>
          </div>
          <button
            type="button"
            className="m3-dialog-close-btn"
            onClick={onClose}
            aria-label="Close shortcuts dialog"
          >
            <X size={18} />
          </button>
        </div>

        <div className="shortcuts-modal-body">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.category} className="shortcuts-category-section">
              <h3 className="shortcuts-category-heading">{group.category}</h3>
              <div className="shortcuts-list">
                {group.items.map((item) => (
                  <div key={item.label} className="shortcuts-item-row">
                    <div className="shortcuts-item-info">
                      <span className="shortcuts-item-label">{item.label}</span>
                      {item.detail && (
                        <span className="shortcuts-item-detail">{item.detail}</span>
                      )}
                    </div>
                    <div className="shortcuts-keys-group" aria-label={`Shortcut: ${item.keys.join(" ")}`}>
                      {item.keys.map((k, idx) => (
                        <span key={idx} className="shortcuts-key-wrapper">
                          <kbd className="shortcut-kbd">{k}</kbd>
                          {idx < item.keys.length - 1 && (
                            <span className="shortcut-separator">+</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="shortcuts-modal-footer">
          <span className="shortcuts-footer-hint">
            Press <kbd className="shortcut-kbd-inline">Esc</kbd> to close or <kbd className="shortcut-kbd-inline">?</kbd> to toggle anytime.
          </span>
          <Badge tone="info">Institutional Hotkeys</Badge>
        </div>
      </div>
    </div>
  );
}
