import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const sourceRoot = new URL("../src/", import.meta.url);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (/\.(tsx?|css)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}


// A screen may be split into a shell file plus a sibling folder of focused parts
// (e.g. Settings.tsx + settings/*.tsx). Contract checks read them as one unit.
async function readScreen(name) {
  const base = new URL(`../src/screens/tenant/${name}.tsx`, import.meta.url);
  const parts = [await readFile(base, "utf8")];
  const dir = join(sourceRoot.pathname, "screens/tenant", name.toLowerCase());
  try {
    for (const entry of await readdir(dir)) {
      if (/\.(tsx?)$/.test(entry)) parts.push(await readFile(join(dir, entry), "utf8"));
    }
  } catch {
    // not split
  }
  return parts.join("\n");
}

async function combinedSource() {
  const files = await walk(sourceRoot.pathname);
  const contents = await Promise.all(files.map((file) => readFile(file, "utf8")));
  return { files, combined: contents.join("\n") };
}

test("frontend is a real-data multi-tenant control plane", async () => {
  const [application, api, configuration] = await Promise.all([
    readFile(new URL("../src/application.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/configuration.ts", import.meta.url), "utf8"),
  ]);
  const { combined } = await combinedSource();
  assert.match(combined, /platformAccess/);
  assert.match(api, /Authorization/);
  assert.match(api, /agents/);
  assert.match(api, /subscription/);
  assert.match(configuration, /local.*testnet.*mainnet/s);
  assert.doesNotMatch(application, /Math\.random\(\)/);
});

test("frontend uses shared design and data primitives", async () => {
  const { combined } = await combinedSource();
  assert.match(combined, /Surface/);
  assert.match(combined, /@tanstack\/react-table/);
  assert.match(combined, /@tanstack\/react-virtual/);
  assert.match(combined, /@tanstack\/react-router/);
  assert.match(combined, /echarts/);
  assert.match(combined, /--primary/);
  assert.match(combined, /48px/);
});

test("frontend has no prohibited developer-facing copy", async () => {
  const { combined } = await combinedSource();
  assert.doesNotMatch(combined, /docker compose|localhost:\d+|raw exception|stack trace/i);
  assert.doesNotMatch(combined, /Math\.random\(\)/);
});

test("frontend integrates enterprise fintech feature suite", async () => {
  const { combined } = await combinedSource();
  assert.match(combined, /PolicySimulator/);
  assert.match(combined, /ActivityTrace/);
  assert.match(combined, /MerchantDirectory/);
  assert.match(combined, /QuorumApprovals/);
  assert.match(combined, /AgentGuardClient/);
});

test("CommandPalette adheres to portal architecture, WAI-ARIA standards, and modal styling", async () => {
  const [commandPalette, globalsCss] = await Promise.all([
    readFile(new URL("../src/command-palette.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/globals.css", import.meta.url), "utf8"),
  ]);

  // Architectural portal requirement: CommandPalette must render into document.body to avoid flex layout corruption
  assert.match(commandPalette, /createPortal/);
  assert.match(commandPalette, /document\.body/);

  // WAI-ARIA & Accessibility requirements
  assert.match(commandPalette, /role="dialog"/);
  assert.match(commandPalette, /aria-modal="true"/);
  assert.match(commandPalette, /role="combobox"/);
  assert.match(commandPalette, /role="listbox"/);
  assert.match(commandPalette, /role="option"/);

  // Keyboard accessibility
  assert.match(commandPalette, /Escape/);
  assert.match(commandPalette, /ArrowDown/);
  assert.match(commandPalette, /ArrowUp/);
  assert.match(commandPalette, /Enter/);

  // Body scroll lock
  assert.match(commandPalette, /document\.body\.style\.overflow\s*=\s*"hidden"/);

  // CSS modal styling guarantees
  assert.match(globalsCss, /\.command-palette-backdrop\s*\{[^}]*position:\s*fixed/);
  assert.match(globalsCss, /\.command-palette-backdrop\s*\{[^}]*z-index:\s*10000/);
  assert.match(globalsCss, /\.command-palette-window/);
});

test("InlineSignIn implements enterprise dual-mode auth, OTP flow, and non-custodial trust badges", async () => {
  const [signin, router] = await Promise.all([
    readFile(new URL("../src/signin.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/router.tsx", import.meta.url), "utf8"),
  ]);

  // Dual-mode auth switcher
  assert.match(signin, /Email Passcode/);
  assert.match(signin, /Web3 Wallet/);

  // OTP verification constraints
  assert.match(signin, /maxLength=\{6\}/);
  assert.match(signin, /inputMode="numeric"/);

  // Non-custodial institutional trust assurance
  assert.match(signin, /Verified payments/);
  assert.match(signin, /Non-Custodial/);
  assert.match(signin, /Secure keys/);

  // Router layout: auth card is isolated strictly to the right panel
  assert.match(router, /landing-auth-panel/);
  assert.match(router, /<InlineSignIn \/>/);
});

test("Navigation layout eliminates duplicate subheader and preserves canonical single-source rail", async () => {
  const router = await readFile(new URL("../src/router.tsx", import.meta.url), "utf8");

  // Invariant: SubheaderTabs must NOT be mounted in AppLayout or AdminLayout
  assert.doesNotMatch(router, /<SubheaderTabs/);

  // Invariant: TenantNav and AdminNav must be mounted as single canonical navigation
  assert.match(router, /<TenantNav \/>/);
  assert.match(router, /<AdminNav \/>/);
});

test("Modern UI/UX invariants: canonical brand mark, zero-mock overview, and address copying", async () => {
  const [navigation, overview, fleet, globalsCss] = await Promise.all([
    readFile(new URL("../src/navigation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/screens/tenant/Overview.tsx", import.meta.url), "utf8"),
    readScreen("Fleet"),
    readFile(new URL("../src/globals.css", import.meta.url), "utf8"),
  ]);

  // Invariant: SlimIconRail must render canonical AgentGuard 'A' brand mark (never legacy 'C')
  assert.match(navigation, /<span className="brand-letter">A<\/span>/);
  assert.doesNotMatch(navigation, /<span className="brand-letter">C<\/span>/);

  // Invariant: Overview screen must NOT have hardcoded mock dollars or fake progress values
  assert.doesNotMatch(overview, /\$295\.7k/);
  assert.doesNotMatch(overview, /\$172k/);
  assert.doesNotMatch(overview, /\$85k/);
  assert.doesNotMatch(overview, /\$36k/);
  assert.doesNotMatch(overview, /style=\{\{\s*width:\s*"42%"\s*\}\}/);

  // Invariant: Fleet table must provide address copying with feedback
  assert.match(fleet, /CopyAddressButton/);
  assert.match(fleet, /navigator\.clipboard/);

  // Invariant: Modern UI design tokens exist in globals.css
  assert.match(globalsCss, /\.agent-cell-wrapper/);
  assert.match(globalsCss, /\.table-copy-btn/);
  assert.match(globalsCss, /\.agent-state-pill/);
  assert.match(globalsCss, /\.top-bar-breadcrumbs/);

  // Invariant: TopBar must never leak raw hexadecimal Org database UUID slices
  const topBar = await readFile(new URL("../src/components/TopBar.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(topBar, /`Org \$\{identity\.tenantId/);
  assert.match(topBar, /identity\.tenantName/);
  assert.match(topBar, /top-bar-breadcrumbs/);
});

test("Phase 2 UI/UX Invariants: live policy data, Policy Studio presets, and merchant copying", async () => {
  const [inspector, policy, merchantDir, quorum, simulator] = await Promise.all([
    readFile(new URL("../src/screens/tenant/AgentInspector.tsx", import.meta.url), "utf8"),
    readScreen("Policy"),
    readFile(new URL("../src/screens/tenant/MerchantDirectory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/screens/tenant/QuorumApprovals.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/screens/tenant/PolicySimulator.tsx", import.meta.url), "utf8"),
  ]);

  // AgentInspector zero-mock invariant: no hardcoded 28% velocity or static 100.00 USDC in slot
  assert.doesNotMatch(inspector, /28% of hourly cap/);
  assert.match(inspector, /useAgentPolicy/);
  assert.match(inspector, /maxSpendPerTxFormatted/);
  assert.match(inspector, /maxSpendPerWindowFormatted/);

  // Policy Studio modern UX invariants: presets, duration chips, and studio grid
  assert.match(policy, /policy-studio-grid/);
  assert.match(policy, /POLICY_PRESETS/);
  assert.match(policy, /Micro Inference/);
  assert.match(policy, /duration-quick-chips/);
  assert.match(policy, /Open "What-If" Simulator/);

  // Merchant Directory UX invariants: copy address feedback and filter chips
  assert.match(merchantDir, /handleCopyAddress/);
  assert.match(merchantDir, /inline-copy-btn/);

  // Quorum Approvals UX invariants: copy address
  assert.match(quorum, /handleCopy/);
  assert.match(quorum, /inline-copy-btn/);

  // Policy Simulator UX invariants: amount quick chips
  assert.match(simulator, /simulator-amount-group/);
  assert.match(simulator, /amount-quick-chips/);
});

test("Theme switcher implements 1-click direct toggle mapping to dark/light without 3-click cycle", async () => {
  const designSystem = await readFile(new URL("../src/design-system.tsx", import.meta.url), "utf8");

  // Invariant: No 3-click theme cycle array
  assert.doesNotMatch(designSystem, /themeCycle/);

  // Invariant: Direct 1-click toggle function exists
  assert.match(designSystem, /toggleTheme/);
  assert.match(designSystem, /resolved === "dark"\s*\?\s*"light"\s*:\s*"dark"/);

  // Invariant: Responsive matchMedia listener maps system preference directly
  assert.match(designSystem, /matchMedia\("\(prefers-color-scheme: dark\)"\)/);
});

test("Dual-Target Packaging configuration and route partitioning invariants", async () => {
  const [configSrc, routerSrc, commandSrc, packageJson] = await Promise.all([
    readFile(new URL("../src/configuration.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/router.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/command-palette.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  // Invariant 1: Configuration exports AppTarget type and target helper predicates
  assert.match(configSrc, /export type AppTarget = "tenant" \| "admin" \| "unified";/);
  assert.match(configSrc, /export const isTenantTarget =/);
  assert.match(configSrc, /export const isAdminTarget =/);
  assert.match(configSrc, /export const isUnifiedTarget =/);

  // Invariant 2: Router partitions route tree based on AppTarget
  assert.match(routerSrc, /isTenantTarget\(\)/);
  assert.match(routerSrc, /isAdminTarget\(\)/);
  assert.match(routerSrc, /isTenantTarget\(\)\s*\?\s*rootRoute\.addChildren\(\[\s*indexRoute,\s*onboardingRoute,\s*appLayoutRoute\.addChildren\(appRoutes\),?\s*\]\)/);
  assert.match(routerSrc, /isAdminTarget\(\)\s*\?\s*rootRoute\.addChildren\(\[\s*indexRoute,\s*onboardingRoute,\s*adminLayoutRoute\.addChildren\(adminRoutes\),?\s*\]\)/);

  // Invariant 3: CommandPalette conditionally excludes admin commands for tenant builds
  assert.match(commandSrc, /!isTenantTarget\(\)/);

  // Invariant 4: package.json provides target build scripts
  const pkg = JSON.parse(packageJson);
  assert.ok(pkg.scripts["build:tenant"], "build:tenant script must exist");
  assert.ok(pkg.scripts["build:admin"], "build:admin script must exist");
  assert.ok(pkg.scripts["build:all"], "build:all script must exist");
});

test("Firewall-ready Nginx configuration enforces edge defense and PoLP", async () => {
  const [tenantNginx, adminNginx] = await Promise.all([
    readFile(new URL("../../../docker/nginx.tenant.conf", import.meta.url), "utf8"),
    readFile(new URL("../../../docker/nginx.admin.conf", import.meta.url), "utf8"),
  ]);

  // Tenant Nginx Invariants: Edge firewall strictly blocks /admin and platform APIs (anti-reconnaissance)
  assert.match(tenantNginx, /location \^~ \/admin \{\s*return 404;\s*\}/);
  assert.match(tenantNginx, /location \^~ \/api\/v1\/platform\/ \{\s*return 404;\s*\}/);

  // Admin Nginx Invariants: Strict RFC 1918 CIDR allowlist and root redirect
  assert.match(adminNginx, /allow 127\.0\.0\.1;/);
  assert.match(adminNginx, /allow 10\.0\.0\.0\/8;/);
  assert.match(adminNginx, /allow 172\.16\.0\.0\/12;/);
  assert.match(adminNginx, /allow 192\.168\.0\.0\/16;/);
  assert.match(adminNginx, /deny all;/);
  assert.match(adminNginx, /location = \/ \{\s*return 302 \/admin\/overview;\s*\}/);
  assert.doesNotMatch(adminNginx, /location \^~ \/api\/v1\/platform\/ \{\s*return 404;/);
});

test("Docker orchestration provisions isolated tenant and admin containers", async () => {
  const [dockerWeb, dockerAdmin, composeDev, composeTestnet, composeMainnet] = await Promise.all([
    readFile(new URL("../../../docker/Dockerfile.web", import.meta.url), "utf8"),
    readFile(new URL("../../../docker/Dockerfile.admin", import.meta.url), "utf8"),
    readFile(new URL("../../../docker/docker-compose.yml", import.meta.url), "utf8"),
    readFile(new URL("../../../docker/docker-compose.testnet.yml", import.meta.url), "utf8"),
    readFile(new URL("../../../docker/docker-compose.mainnet.yml", import.meta.url), "utf8"),
  ]);

  // Dockerfile.web serves tenant build with tenant Nginx
  assert.match(dockerWeb, /ARG VITE_APP_TARGET=tenant/);
  assert.match(dockerWeb, /nginx\.tenant\.conf/);
  assert.match(dockerWeb, /dist\/tenant/);

  // Dockerfile.admin serves admin build with admin Nginx
  assert.match(dockerAdmin, /ARG VITE_APP_TARGET=admin/);
  assert.match(dockerAdmin, /nginx\.admin\.conf/);
  assert.match(dockerAdmin, /dist\/admin/);

  // Compose files provision both agentguard-web and agentguard-admin-web
  for (const compose of [composeDev, composeTestnet, composeMainnet]) {
    assert.match(compose, /agentguard-web:/);
    assert.match(compose, /agentguard-admin-web:/);
    assert.match(compose, /Dockerfile\.admin/);
    assert.match(compose, /3111/);
  }
});

test("Modern fintech theme invariants: typography, glassmorphism, radar telemetry, and surface elevation", async () => {
  const [globalsCss, topBarSrc, designSystemSrc] = await Promise.all([
    readFile(new URL("../src/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/TopBar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/design-system.tsx", import.meta.url), "utf8"),
  ]);

  // Invariant 1: OpenType feature settings and tabular numbers for financial figures
  assert.match(globalsCss, /font-feature-settings:\s*"cv02",\s*"cv03",\s*"cv04",\s*"cv11",\s*"ss01"/);
  assert.match(globalsCss, /font-variant-numeric:\s*tabular-nums/);

  // Invariant 2: Surface elevation with light-catching inner highlights
  assert.match(globalsCss, /--card-highlight:/);
  assert.match(globalsCss, /box-shadow:\s*var\(--card-shadow\),\s*var\(--card-highlight\)/);

  // Invariant 3: Frosted glassmorphism with high-performance backdrop blur on TopBar
  assert.match(globalsCss, /backdrop-filter:\s*blur\(16px\)\s*saturate\(180%\)/);

  // Invariant 4: Dual-ring radar beacon for Monad Parallel EVM 400ms finality
  assert.match(topBarSrc, /beacon-radar/);
  assert.match(topBarSrc, /beacon-radar-ping/);
  assert.match(topBarSrc, /beacon-radar-dot/);
  assert.match(globalsCss, /\.beacon-radar-ping\s*\{/);
  assert.match(globalsCss, /@keyframes radar-ping/);

  // Invariant 5: Smooth theme transition and tactile spring click micro-interactions
  assert.match(globalsCss, /transition:\s*background-color\s*150ms/);
  assert.match(globalsCss, /\.control:active/);
  assert.match(designSystemSrc, /theme-toggle-icon/);
});






test("finops dual-denomination rate cards and enterprise pricing models are integrated", async () => {
  const [settingsSrc, apiSrc] = await Promise.all([
    readScreen("Settings"),
    readFile(new URL("../src/api.ts", import.meta.url), "utf8"),
  ]);

  // ADR 0010: Six enterprise contract models
  assert.match(settingsSrc, /flat_discount/);
  assert.match(settingsSrc, /tiered_volume/);
  assert.match(settingsSrc, /committed_ptu/);
  assert.match(settingsSrc, /batch_discount/);
  assert.match(settingsSrc, /per_unit_request/);
  assert.match(settingsSrc, /hybrid_commit_volume/);

  // Settings UI contains AI Rate Cards tab, model-level overrides, Tool catalog, and FinOps controls
  // (plain-language pass: section copy is now in everyday language, not jargon)
  assert.match(settingsSrc, /AI Rate Cards/);
  assert.match(settingsSrc, /Cache Read/);
  assert.match(settingsSrc, /Cache Write/);
  assert.match(settingsSrc, /Tool & service pricing/);
  assert.match(settingsSrc, /Monthly usage cap/);
  assert.match(settingsSrc, /Volume discount tiers/);
  assert.match(settingsSrc, /Estimate your cost/);
  assert.match(settingsSrc, /Batch mode \(50% off\)/);

  // API endpoints, types, and hooks wired
  assert.match(apiSrc, /useTenantPricingModel/);
  assert.match(apiSrc, /useUpdateTenantPricingModel/);
  assert.match(apiSrc, /useCalculateSpend/);
  assert.match(apiSrc, /ToolCatalogEntry/);
  assert.match(apiSrc, /batch_discount/);
  assert.match(apiSrc, /per_unit_request/);
  assert.match(apiSrc, /hybrid_commit_volume/);
  assert.match(apiSrc, /\/tenant\/pricing-model/);
  assert.match(apiSrc, /\/finops\/calculate-spend/);
});

test("ADR-0008: Alibaba Qwen 3.8 Max AI Copilot and Autonomous Circuit Breaker are integrated", async () => {
  const [copilotSrc, simulatorSrc, policySrc, apiSrc] = await Promise.all([
    readFile(new URL("../src/components/AICopilot.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/screens/tenant/PolicySimulator.tsx", import.meta.url), "utf8"),
    readScreen("Policy"),
    readFile(new URL("../src/api.ts", import.meta.url), "utf8"),
  ]);

  // AI Copilot connects to /copilot/compile-policy and stages into Policy Studio
  assert.match(copilotSrc, /useCompilePolicy/);
  assert.match(copilotSrc, /agentguard_staged_policy/);
  assert.match(copilotSrc, /Apply to Policy/);
  assert.match(policySrc, /agentguard_staged_policy/);
  assert.match(apiSrc, /\/copilot\/compile-policy/);

  // ADR-0008 Mathematical Invariant Guard: maxPerTx must never exceed maxPerWindow
  // The UI blocks staging an invalid policy to Policy Studio (mirrors Qwen backend bounds clamping)
  assert.match(copilotSrc, /AlertTriangle/, "AICopilot must import AlertTriangle for invariant warning");
  assert.match(copilotSrc, /copilot-invariant-warning/, "AICopilot must render invariant violation banner class");
  assert.match(copilotSrc, /Limits don't add up/, "AICopilot must display a clear limits-conflict message");
  assert.match(copilotSrc, /maxPerTx.*maxPerWindow|maxPerWindow.*maxPerTx/, "AICopilot must compare maxPerTx and maxPerWindow values");

  // React Hook rules: All hooks in AICopilot must precede conditional return (open check)
  const openReturnIndex = copilotSrc.indexOf("if (!open) return null;");
  assert.ok(openReturnIndex !== -1, "AICopilot must handle !open with return null");
  const lastHookMatch = [...copilotSrc.matchAll(/\buse(?:State|Effect|Memo|Ref|Navigate|CompilePolicy)\b/g)].pop();
  assert.ok(lastHookMatch && lastHookMatch.index < openReturnIndex, "All React hook invocations in AICopilot must occur before the !open early return");
  assert.match(copilotSrc, /createPortal/, "AICopilot must render to portal root");

  // PolicySimulator includes ADR-0008 Multi-Tier Circuit Breaker Testbench
  assert.match(simulatorSrc, /Safety test lab/);
  assert.match(simulatorSrc, /Simulate a runaway loop/);
  assert.match(simulatorSrc, /Normal/);
  assert.match(simulatorSrc, /Paused/);
  assert.match(simulatorSrc, /On trial/);
  assert.match(simulatorSrc, /useTripKillSwitch/);
  assert.match(simulatorSrc, /runRunawayCircuitBreaker/);
});

test("ADR-0014: Agent Wallet Provisioning, Organization Treasury Wallets, and Load/Unload Flows are integrated", async () => {
  const [treasurySrc, fleetSrc, apiSrc] = await Promise.all([
    readFile(new URL("../src/screens/tenant/Treasury.tsx", import.meta.url), "utf8"),
    readScreen("Fleet"),
    readFile(new URL("../src/api.ts", import.meta.url), "utf8"),
  ]);

  // Treasury multi-wallet management & access control
  assert.match(treasurySrc, /useOrganizationWallets/);
  assert.match(treasurySrc, /useRegisterOrganizationWallet/);
  assert.match(treasurySrc, /useGrantWalletAccess/);
  assert.match(treasurySrc, /useRevokeWalletAccess/);
  assert.match(treasurySrc, /useUpdateWalletThreshold/);
  assert.match(treasurySrc, /treasuryOwnershipMessage/);

  // Fleet agent registration supports sovereign and external modes
  assert.match(fleetSrc, /walletSource === "sovereign"/);
  assert.match(fleetSrc, /walletSource === "external"/);
  assert.match(fleetSrc, /Managed wallets/);

  // Fleet agent row Load and Unload modals
  assert.match(fleetSrc, /useLoadAgentWallet/);
  assert.match(fleetSrc, /useUnloadAgentWallet/);
  assert.match(fleetSrc, /Load agent wallet/);
  assert.match(fleetSrc, /Unload to treasury/);

  // API endpoints wired for treasury and wallet transfers
  assert.match(apiSrc, /\/organization\/wallets/);
  assert.match(apiSrc, /\/agents\/.*\/load/);
  assert.match(apiSrc, /\/agents\/.*\/unload/);
  assert.match(apiSrc, /\/agents\/.*\/wallet-transfers/);
});

test("Tier-1 Recommendations: ERC-4337 Paymaster sponsorship and ERC-6551 Token Bound Accounts are integrated", async () => {
  const [configSrc, hooksSrc, fleetSrc] = await Promise.all([
    readFile(new URL("../src/configuration.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/usePolicyContracts.ts", import.meta.url), "utf8"),
    readScreen("Fleet"),
  ]);

  // Contract coordinates in configuration
  assert.match(configSrc, /circuitPaymaster/);
  assert.match(configSrc, /agentIdentityRegistry/);
  assert.match(configSrc, /agentAccountImplementation/);
  assert.match(configSrc, /agentPassportNFT/);

  // Viem hooks and ABIs
  assert.match(hooksSrc, /CIRCUIT_PAYMASTER_ABI/);
  assert.match(hooksSrc, /ERC6551_REGISTRY_ABI/);
  assert.match(hooksSrc, /AGENT_PASSPORT_NFT_ABI/);
  assert.match(hooksSrc, /usePaymasterEligibility/);
  assert.match(hooksSrc, /useAgentPassport/);
  assert.match(hooksSrc, /useAgentTba/);

  // Fleet screen UI integration
  assert.match(fleetSrc, /Agent identity wallet/);
  assert.match(fleetSrc, /AgentGuard covers network fees/);
  assert.match(fleetSrc, /Identity wallet/);

  // Treasury screen Paymaster float replenishment integration (plain-language copy: "network fee balance")
  const treasurySrc = await readFile(new URL("../src/screens/tenant/Treasury.tsx", import.meta.url), "utf8");
  assert.match(hooksSrc, /usePaymasterTreasuryBalance/);
  assert.match(hooksSrc, /useDepositPaymasterGas/);
  assert.match(treasurySrc, /Network fee balance/);
  assert.match(treasurySrc, /Add network fee funds/);
});

test("Institutional UI Upgrades: Batch Fleet, Policy Dry-Run, Plain-Language Security Tab, 4-Scenario Testbench, and Compliance Manifest", async () => {
  const [fleetSrc, policySrc, inspectorSrc, simulatorSrc, activitySrc, globalsCss] = await Promise.all([
    readScreen("Fleet"),
    readScreen("Policy"),
    readFile(new URL("../src/screens/tenant/AgentInspector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/screens/tenant/PolicySimulator.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/screens/tenant/ActivityTrace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/globals.css", import.meta.url), "utf8"),
  ]);

  // Feature 1: Fleet Management Batch Actions, Faceted Filters & Export
  assert.match(fleetSrc, /selectedAgents/);
  assert.match(fleetSrc, /fleet-batch-bar/);
  assert.match(fleetSrc, /Pause selected/);
  assert.match(fleetSrc, /Resume selected/);
  assert.match(fleetSrc, /Export CSV/);
  assert.match(fleetSrc, /Export JSON/);
  assert.match(fleetSrc, /statusFilter/);
  assert.match(fleetSrc, /sourceFilter/);
  assert.match(fleetSrc, /riskFilter/);

  // Feature 2: Policy Studio Live Pre-Flight Sandbox & Staged Diff Analysis
  assert.match(policySrc, /policy-diff-section/);
  assert.match(policySrc, /policy-diff-table/);
  assert.match(policySrc, /policy-dryrun-section/);
  assert.match(policySrc, /dryRunVerdict/);
  assert.match(policySrc, /Test before you publish/);
  assert.match(policySrc, /ERR_MAX_PER_TX_EXCEEDED/);
  assert.match(policySrc, /ERR_MAX_PER_WINDOW_EXCEEDED/);
  assert.match(policySrc, /ERR_MERCHANT_NOT_WHITELISTED/);

  // Feature 3: Agent Inspector Security tab (hardware attestation & identity, surfaced in plain language
  // rather than raw TEE registers / ERC standard numbers)
  assert.match(inspectorSrc, /activeTab === "security"/);
  assert.match(inspectorSrc, /Hardware security/);
  assert.match(inspectorSrc, /Agent identity/);
  assert.match(inspectorSrc, /trustScoreLabel/);
  assert.match(inspectorSrc, /rolloverText/);

  // Feature 4: Policy Simulator 4-Scenario Adversarial Threat Suite & Visual Pipeline
  assert.match(simulatorSrc, /physics-pipeline-container/);
  assert.match(simulatorSrc, /pipelineSteps/);
  assert.match(simulatorSrc, /threat-scenarios-grid/);
  assert.match(simulatorSrc, /runRunawayCircuitBreaker/);
  assert.match(simulatorSrc, /runSybilFloodingTest/);
  assert.match(simulatorSrc, /runPromptInjectionTest/);
  assert.match(simulatorSrc, /runReplayAttackTest/);

  // Feature 5: Activity & Audit Compliance Manifest Export & Live Stream Mode
  assert.match(activitySrc, /liveStreamActive/);
  assert.match(activitySrc, /exportComplianceJson/);
  assert.match(activitySrc, /exportComplianceCsv/);
  assert.match(activitySrc, /SOC2-CC6\.1 \/ MiCA Title III/);

  // CSS Tokens & styling verification
  assert.match(globalsCss, /\.fleet-batch-bar/);
  assert.match(globalsCss, /\.policy-dryrun-section/);
  assert.match(globalsCss, /\.policy-diff-table/);
  assert.match(globalsCss, /\.physics-pipeline-container/);
  assert.match(globalsCss, /\.threat-scenarios-grid/);
});

test("Options 1-3: Swarm DAG Governance, Canary Policy Rollout with Atomic Rollback, and Predictive Threat Radar are integrated", async () => {
  const [fleetSrc, swarmSrc, policySrc, activitySrc, apiSrc, globalsCss] = await Promise.all([
    readScreen("Fleet"),
    readFile(new URL("../src/components/SwarmTopologyVisualizer.tsx", import.meta.url), "utf8"),
    readScreen("Policy"),
    readFile(new URL("../src/screens/tenant/ActivityTrace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/globals.css", import.meta.url), "utf8"),
  ]);

  // Option 1: Hierarchical Swarm Governance & Interactive DAG Visualizer
  assert.match(fleetSrc, /fleet-view-toggle/);
  assert.match(fleetSrc, /Team map/);
  assert.match(fleetSrc, /SwarmTopologyVisualizer/);
  assert.match(swarmSrc, /swarm-topology-container/);
  assert.match(swarmSrc, /supervisor-tier/);
  assert.match(swarmSrc, /workers-tier/);
  assert.match(swarmSrc, /pulsing-connector/);
  assert.match(swarmSrc, /Isolate Node/);
  assert.match(swarmSrc, /Delegate Sub-Budget/);
  assert.match(swarmSrc, /Confirm Delegation/);
  assert.match(swarmSrc, /useTripKillSwitch/);
  assert.match(apiSrc, /SwarmNode/);
  assert.match(apiSrc, /SwarmDelegation/);

  // Option 2: Canary Policy Deployments with Automated Onchain Rollback
  assert.match(policySrc, /policy-canary-section/);
  assert.match(policySrc, /canary-stepper/);
  assert.match(policySrc, /0% Staged/);
  assert.match(policySrc, /10% Pilot/);
  assert.match(policySrc, /25% Scale/);
  assert.match(policySrc, /50% Trial/);
  assert.match(policySrc, /100% Consensus/);
  assert.match(policySrc, /Roll back now/);
  assert.match(policySrc, /handleEmergencyRollback/);
  assert.match(policySrc, /handleAdvanceCanary/);
  assert.match(policySrc, /Unusual activity detected/);
  assert.match(apiSrc, /CanaryDeployment/);
  assert.match(apiSrc, /CanaryStage/);

  // Option 3: Predictive Threat Radar & Counterparty Category Drift Engine
  assert.match(activitySrc, /threat-radar-surface/);
  assert.match(activitySrc, /threatIntelligence/);
  assert.match(activitySrc, /Overall risk/);
  assert.match(activitySrc, /Spending speed spike/);
  assert.match(activitySrc, /New merchants/);
  assert.match(activitySrc, /Limit testing/);
  assert.match(activitySrc, /threat-categories/);
  assert.match(activitySrc, /handleRemediate/);
  assert.match(activitySrc, /Pause agent/);
  assert.match(activitySrc, /All clear: no unusual activity detected/);
  assert.match(apiSrc, /ThreatAnomaly/);
  assert.match(apiSrc, /ThreatAnomalyType/);

  // CSS Tokens verification for Options 1-3
  assert.match(globalsCss, /\.fleet-view-toggle/);
  assert.match(globalsCss, /\.swarm-topology-container/);
  assert.match(globalsCss, /\.swarm-node-card/);
  assert.match(globalsCss, /\.pulsing-connector/);
  assert.match(globalsCss, /\.policy-canary-section/);
  assert.match(globalsCss, /\.canary-stepper/);
  assert.match(globalsCss, /\.threat-radar-surface/);
  assert.match(globalsCss, /\.threat-anomaly-card/);
});

test("Navigation is a labeled, grouped sidebar with plain-language names and a mobile drawer", async () => {
  const [navigation, topBar, globalsCss] = await Promise.all([
    readFile(new URL("../src/navigation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/TopBar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/globals.css", import.meta.url), "utf8"),
  ]);

  // Grouped, labeled navigation instead of an icon-only rail
  assert.match(navigation, /tenantNavGroups/);
  assert.match(navigation, /adminNavGroups/);
  assert.match(navigation, /sidebar-group-label/);
  assert.match(navigation, /aria-current/);
  for (const label of ["Agents", "Spending rules", "Test rules", "Approvals", "Treasury", "Activity", "Organizations", "Payments"]) {
    assert.match(navigation, new RegExp(`label: "${label}"`));
  }

  // No protocol or jargon terms in navigation labels
  assert.doesNotMatch(navigation, /label: "(Fleet|Quorum|Simulator|Reconciliation|Billing ledger)"/);

  // Collapsible with persistence, and an off-canvas drawer on small screens
  assert.match(navigation, /agentguard-sidebar-collapsed/);
  assert.match(navigation, /TOGGLE_NAV_EVENT/);
  assert.match(topBar, /top-bar-menu-btn/);
  assert.match(globalsCss, /\.sidebar\.is-open/);
  assert.match(globalsCss, /@media \(max-width: 860px\)/);

  // Top bar no longer shows raw chain timing
  assert.doesNotMatch(topBar, /beacon-speed/);
});


test("role-aware navigation mirrors the gateway role matrix", async () => {
  const { canViewDestination } = await import("../src/access.ts");

  // Unknown role (still loading) never hides anything.
  assert.equal(canViewDestination("", "/app/treasury"), true);
  assert.equal(canViewDestination(null, "/app/billing"), true);

  // Settlement-only destinations: super_admin and treasury.
  for (const path of ["/app/billing", "/app/quorum"]) {
    assert.equal(canViewDestination("super_admin", path), true);
    assert.equal(canViewDestination("treasury", path), true);
    for (const role of ["sec_ops", "fleet_devops", "agent_developer", "auditor"]) {
      assert.equal(canViewDestination(role, path), false, `${role} should not see ${path}`);
    }
  }

  // Treasury is visible read-only to security and audit, hidden from engineering roles.
  assert.equal(canViewDestination("auditor", "/app/treasury"), true);
  assert.equal(canViewDestination("sec_ops", "/app/treasury"), true);
  assert.equal(canViewDestination("fleet_devops", "/app/treasury"), false);
  assert.equal(canViewDestination("agent_developer", "/app/treasury"), false);

  // Everything else is open to every role.
  assert.equal(canViewDestination("fleet_devops", "/app/fleet"), true);
  assert.equal(canViewDestination("auditor", "/app/activity"), true);
});

test("plain-language copy maps reason codes, events and trust scores", async () => {
  const copy = await import("../src/copy.ts");

  assert.equal(copy.reasonCodeLabel("ERR_NONE"), "Approved");
  assert.equal(copy.reasonCodeLabel(null), "Approved");
  assert.match(copy.reasonCodeLabel("ERR_KILL_SWITCH_ACTIVE"), /paused/);
  assert.match(copy.reasonCodeLabel("ERR_SOMETHING_NEW"), /^Blocked/);
  assert.equal(copy.isApprovedReasonCode("ERR_NONE"), true);
  assert.equal(copy.isApprovedReasonCode("ERR_EXPIRED"), false);

  assert.equal(copy.eventLabel("payment_cleared"), "Payment approved");
  assert.equal(copy.eventLabel("circuit_tripped"), "Agent paused");
  assert.equal(copy.eventLabel("someNewEvent"), "Some new event");

  // Trust is only reported when there is a real score.
  assert.equal(copy.trustScoreLabel(undefined), "Not yet scored");
  assert.equal(copy.trustScoreLabel(null), "Not yet scored");
  assert.equal(copy.trustScoreLabel(90), "High");
  assert.equal(copy.trustScoreLabel(50), "Medium");
  assert.equal(copy.trustScoreLabel(10), "Low");
});

test("no fabricated data paths remain in screens", async () => {
  const { combined } = await combinedSource();
  assert.doesNotMatch(combined, /5\.20% APY/);
  assert.doesNotMatch(combined, /trustScoreForTier/);
  assert.doesNotMatch(combined, /estimatedGas:\s*decision/);
  assert.doesNotMatch(combined, /zScore:\s*[0-9]/);
  assert.doesNotMatch(combined, /spendCapUsdc/);
});

test("push channel parses SSE, maps events to refetches, and relaxes polling only while connected", async () => {
  const { parseSseChunk, keysForEvent, pollInterval, isRealtimeConnected } = await import("../src/realtime.ts");

  // Complete events are returned; the unfinished tail stays in the buffer; comments are ignored.
  const first = parseSseChunk(": hi\n\nevent: approvals_changed\ndata: {}\n\nevent: wallets_ch");
  assert.deepEqual(first.events, [{ event: "approvals_changed", data: "{}" }]);
  assert.equal(first.rest, "event: wallets_ch");
  const second = parseSseChunk(first.rest + "anged\ndata: {}\n\n");
  assert.deepEqual(second.events, [{ event: "wallets_changed", data: "{}" }]);
  assert.deepEqual(parseSseChunk("event: x\r\ndata: a\r\ndata: b\r\n\r\n").events, [{ event: "x", data: "a\nb" }]);

  // Change events refetch just what they affect; chain events and unknown types refetch the chain views.
  assert.deepEqual(keysForEvent("approvals_changed"), [["pending-approvals"], ["wallet-transfers"]]);
  assert.ok(keysForEvent("payment_cleared").some((key) => key[0] === "telemetry-events"));
  assert.ok(keysForEvent("circuit_tripped").some((key) => key[0] === "agents"));
  assert.equal(keysForEvent("telemetry_gap"), "all");

  // Disconnected: the fallback interval. (Connected relaxes to a slow safety net; covered end to end by the UI suite.)
  assert.equal(isRealtimeConnected(), false);
  assert.equal(pollInterval(3000)(), 3000);
  assert.equal(pollInterval(20000)(), 20000);
});


test("telemetry scrubs identifiers and secrets before anything leaves the browser", async () => {
  const { scrubMessage } = await import("../src/telemetry.ts");
  assert.equal(
    scrubMessage("Failed to load https://api.example.com/v1/items?token=abc123#x now"),
    "Failed to load https://api.example.com/v1/items now",
  );
  assert.equal(
    scrubMessage("transfer to 0xA978BD5ea722e96caFe47384877F39f8E7EAD22f failed"),
    "transfer to 0x… failed",
  );
  assert.equal(scrubMessage("auth failed: bearer: eyJhbGciOi.secret"), "auth failed: bearer=…");
  assert.equal(scrubMessage("line one\nline two\u0000"), "line one line two");
  assert.ok(scrubMessage("x".repeat(1000)).length <= 200);
});

test("telemetry reporter batches the latest metrics, dedupes and caps errors", async () => {
  const { createReporter } = await import("../src/telemetry.ts");
  const sent = [];
  const reporter = createReporter({
    endpoint: "/api/v1/telemetry/web-vitals",
    release: "tenant",
    page: () => "/app/fleet",
    transport: (url, body) => {
      sent.push({ url, body: JSON.parse(body) });
      return true;
    },
  });

  assert.equal(reporter.flush(), false, "nothing gathered means nothing sent");

  reporter.addMetric({ name: "CLS", value: 0.02, rating: "good" });
  reporter.addMetric({ name: "CLS", value: 0.05, rating: "good" });
  reporter.addMetric({ name: "LCP", value: Number.NaN });
  for (let index = 0; index < 30; index += 1) reporter.addError({ kind: "error", message: `failure ${index}` });
  reporter.addError({ kind: "error", message: "failure 0" });
  assert.equal(reporter.flush(), true);

  assert.equal(sent.length, 1);
  const [{ url, body }] = sent;
  assert.equal(url, "/api/v1/telemetry/web-vitals");
  assert.equal(body.page, "/app/fleet");
  assert.deepEqual(body.metrics, [{ name: "CLS", value: 0.05, rating: "good" }]);
  assert.equal(body.errors.length, 5);
  assert.equal(new Set(body.errors.map((entry) => entry.message)).size, 5);
  assert.equal(reporter.flush(), false, "a flushed batch is not sent twice");
});

test("fonts are self-hosted: no third-party font origins in the app shell", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/);
  const faces = await readFile(new URL("fonts.css", sourceRoot), "utf8");
  assert.match(faces, /@fontsource-variable\/inter\/files\//);
  assert.match(faces, /@fontsource-variable\/jetbrains-mono\/files\//);
  assert.doesNotMatch(faces, /https?:\/\//);
  const entry = await readFile(new URL("main.tsx", sourceRoot), "utf8");
  assert.match(entry, /\.\/fonts\.css/);
});

test("security headers have one source and the right shape per profile", async () => {
  const docker = (name) => readFile(new URL(`../../../docker/${name}`, import.meta.url), "utf8");
  const [tenant, admin, headers, production, local, webfile, adminfile, composeDev, composeTestnet, composeMainnet] =
    await Promise.all([
      docker("nginx.tenant.conf"),
      docker("nginx.admin.conf"),
      docker("nginx/security-headers.conf"),
      docker("nginx/csp.production.conf"),
      docker("nginx/csp.local.conf"),
      docker("Dockerfile.web"),
      docker("Dockerfile.admin"),
      docker("docker-compose.yml"),
      docker("docker-compose.testnet.yml"),
      docker("docker-compose.mainnet.yml"),
    ]);

  for (const conf of [tenant, admin]) {
    // The policy lives only in the shared snippets, never pasted into a server config.
    assert.doesNotMatch(conf, /Content-Security-Policy/);
    assert.match(conf, /include \/etc\/nginx\/snippets\/security-headers\.conf;/);
    assert.doesNotMatch(conf, /fonts\.googleapis\.com/);
    // Every location that sets its own headers (and so drops inherited ones) pulls the shared list back in.
    const locations = conf.split(/\n\s*location /).slice(1);
    for (const location of locations.filter((block) => /add_header/.test(block))) {
      assert.match(location, /include \/etc\/nginx\/snippets\/security-headers\.conf;/);
    }
    // The live-update stream must not be buffered or cut by the normal API timeout.
    const stream = conf.match(/location = \/api\/v1\/telemetry\/stream \{[^}]*\}/)?.[0] ?? "";
    assert.match(stream, /proxy_buffering off;/);
    assert.match(stream, /proxy_read_timeout 1h;/);
    assert.match(stream, /proxy_set_header Connection "";/);
  }

  assert.match(headers, /include \/etc\/nginx\/snippets\/csp\.conf;/);
  assert.match(headers, /Reporting-Endpoints/);

  for (const policy of [production, local]) {
    assert.match(policy, /Content-Security-Policy "[^"]*script-src 'self';/);
    assert.match(policy, /object-src 'none'/);
    assert.match(policy, /frame-ancestors 'none'/);
    // Staged strict policy reports to the gateway instead of enforcing.
    assert.match(policy, /Content-Security-Policy-Report-Only "[^"]*style-src 'self';/);
    assert.match(policy, /report-uri \/api\/v1\/telemetry\/csp-report/);
    assert.match(policy, /__RPC_ORIGIN__/);
    assert.doesNotMatch(policy, /fonts\.googleapis\.com/);
  }
  assert.doesNotMatch(production, /localhost|127\.0\.0\.1/);
  assert.match(local, /http:\/\/localhost:\*/);

  for (const file of [webfile, adminfile]) {
    assert.match(file, /ARG CSP_PROFILE=production/);
    assert.match(file, /render-snippets\.sh/);
  }
  assert.match(composeDev, /CSP_PROFILE: local/);
  assert.doesNotMatch(composeTestnet, /CSP_PROFILE: local/);
  assert.doesNotMatch(composeMainnet, /CSP_PROFILE: local/);
});
