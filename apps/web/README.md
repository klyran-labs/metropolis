# @computex/web

The official **ComputeX** Enterprise Two-Sided DePIN Compute Marketplace built with React 19, Vite 8, TailwindCSS v4, React Router v7, and Viem 2.x.

---

## Two-Sided DePIN Marketplace Architecture

ComputeX decouples compute consumers (buyers) from compute suppliers (sellers) while providing unified market discovery and atomic Delivery-versus-Payment (DvP) settlement on Monad Testnet (Chain ID `10143`):

### 1. 🛒 Public Marketplace Hub & Trading Terminal
- **126-Node Fleet Explorer**: High-density data grid across NVIDIA Blackwell (B200/GB200), Hopper (H100/H200), Ada (RTX 4090/L40S), AMD Instinct (MI300X), AMD EPYC (9654/9754), and Intel Xeon (8592+) across 6 global datacenters.
- **60+ FPS Canvas Depth Visualizer**: HTML5 2D Canvas rendering the live bid/ask order book depth ladder with sub-millisecond WebSocket updates.
- **CLOB Order Entry**: EIP-712 sender-bound order submission with instant 400ms Monad finality.
- **Physical Telemetry Radar**: Real-time NVML GPU/CPU core loads, memory allocation, edge ping latency, and DuckDB 24h EWMA SLA verification.

### 2. 💻 Buyer Portal (Compute Consumer / Renter)
- **Declarative URL Routing**: Full React Router v7 integration (`/buyer/overview`, `/buyer/marketplace`, `/buyer/orders`, `/buyer/instances`, `/buyer/funding`, `/buyer/telemetry`, `/buyer/settings`).
- **Active Instances**: Live cards of provisioned nodes with remaining duration countdowns, live pings, and cluster topologies (1x, 4x NVLink, 8x SXM Pod).
- **Zero-Mock Credential Delivery (`CredentialDelivery.tsx`)**: 1-click retrieval of OpenSSH Ed25519 commands and WireGuard mesh profiles (`wg0.conf`) derived cryptographically on-the-fly.
- **Escrow & Burn Rate**: Real-time tracking of locked MON escrow, per-second burn rate ticker ($\text{mMON/sec}$), and deposit/top-up modal.
- **Parametric SLA Insurance**: Automatic 100% refund protection if a node breaches 99.50% uptime.

### 3. ⚡ Seller Portal (Hardware Supplier / DePIN Miner)
- **Declarative URL Routing**: Route-synced console (`/operator/overview`, `/operator/fleet`, `/operator/listings`, `/operator/leases`, `/operator/sla-vault`, `/operator/settlements`, `/operator/settings`).
- **Fleet Inventory Management**: Full control over provider's physical compute nodes (edit asking rates in MON/hr, toggle availability: Online / Maintenance / Delist).
- **Node Onboarding Modal**: Form to register new GPU/CPU rigs into the live marketplace with client-side validation and modal focus traps.
- **Real-Time Streaming Earnings**: Live ticking counter accumulating MON earned per second from active customer leases.
- **Non-Custodial Claim**: 1-click withdrawal of settled earnings directly to the provider's Monad address.
- **Bonded SLA Stake Vault**: Manage bonded MON collateral backing the 3-of-5 threshold SLA insurance.

---

## Production UX & Reliability Features

1. **Client-Side Routing (`react-router-dom` v7)**:
   - Deep-linkable URLs with browser history (back/forward) support.
   - Strict role exclusivity redirect guards (`/buyer/*` vs `/operator/*`).
2. **Resilient Error Boundaries (`ErrorBoundary.tsx`)**:
   - Class-based React Error Boundaries isolating navigation header and portal subtrees with isolated recovery prompts without crashing the app shell.
3. **Global Toast System (`ToastContext.tsx`)**:
   - Real-time notification toasts with animated progress countdowns, dismiss controls, and clickable links to Monad Testnet Explorer (`https://testnet.monadexplorer.com/tx/...`).
4. **Slide-Over Notification Drawer (`NotificationDrawer.tsx`)**:
   - Live stream of recent fills, onchain settlements, and SLA slashing attestations accessible via the header bell icon.
5. **Accessibility & Focus Trapping (`useFocusTrap.ts`)**:
   - Modals equipped with WCAG-compliant dialog attributes (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`), keyboard focus traps, and `Escape` key handlers.
   - Form inputs with `inputMode="decimal"` and explicit `role="alert"` validation error messages.
6. **Institutional Account Popover (`FintechHeader.tsx`)**:
   - Consolidated header eliminating button crowding: live 400ms latency badge, dark/light theme toggle, notifications drawer trigger, and institutional Account popover menu.
7. **Dark / Light Mode System (`ThemeContext.tsx`)**:
   - Persistent theme state synchronized to the document root element with Tailwind CSS v4 class tokens.
8. **Performance & Code Splitting**:
   - `React.lazy` route-level code-splitting for `BuyerPortal` and `SellerPortal` with skeleton loading fallbacks.

---

## Development & Verification

```bash
# Start local development server (Port 3110)
npm run dev

# Run production build (outputs to dist/)
npm run build

# Run unit tests (EIP-712, depth math, SLA evaluation, role exclusivity)
node --test apps/web/test/frontend.test.mjs
```

---

## Zero-Mock Verification Standards

In compliance with repository `AGENTS.md` policy:
- No hardcoded fallback addresses (`0x70997970C51812dc3A010C7d01b50e0d17dc79C8`).
- No synthetic balances or fake math loops (`Math.random`).
- All empty states render honest zero balances (`0.0000 MON`) with clear call-to-actions.
