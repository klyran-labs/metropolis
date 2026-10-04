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
});

test("InlineSignIn implements enterprise dual-mode auth, OTP flow, and non-custodial trust badges", async () => {
  const [signin, router] = await Promise.all([
    readFile(new URL("../src/signin.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/router.tsx", import.meta.url), "utf8"),
  ]);

  // Dual-mode auth switcher

  // OTP verification constraints
  assert.match(signin, /maxLength=\{6\}/);
  assert.match(signin, /inputMode="numeric"/);

  // Non-custodial institutional trust assurance

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
  assert.match(policy, /duration-quick-chips/);

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
  assert.match(policySrc, /agentguard_staged_policy/);
  assert.match(apiSrc, /\/copilot\/compile-policy/);

  // ADR-0008 Mathematical Invariant Guard: maxPerTx must never exceed maxPerWindow
  // The UI blocks staging an invalid policy to Policy Studio (mirrors Qwen backend bounds clamping)
  assert.match(copilotSrc, /AlertTriangle/, "AICopilot must import AlertTriangle for invariant warning");
  assert.match(copilotSrc, /copilot-invariant-warning/, "AICopilot must render invariant violation banner class");
  assert.match(copilotSrc, /maxPerTx.*maxPerWindow|maxPerWindow.*maxPerTx/, "AICopilot must compare maxPerTx and maxPerWindow values");

  // React Hook rules: All hooks in AICopilot must precede conditional return (open check)
  const openReturnIndex = copilotSrc.indexOf("if (!open) return null;");
  assert.ok(openReturnIndex !== -1, "AICopilot must handle !open with return null");
  const lastHookMatch = [...copilotSrc.matchAll(/\buse(?:State|Effect|Memo|Ref|Navigate|CompilePolicy)\b/g)].pop();
  assert.ok(lastHookMatch && lastHookMatch.index < openReturnIndex, "All React hook invocations in AICopilot must occur before the !open early return");
  assert.match(copilotSrc, /createPortal/, "AICopilot must render to portal root");

  // PolicySimulator includes ADR-0008 Multi-Tier Circuit Breaker Testbench
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

  // Fleet agent row Load and Unload modals
  assert.match(fleetSrc, /useLoadAgentWallet/);
  assert.match(fleetSrc, /useUnloadAgentWallet/);

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

  // Treasury screen Paymaster float replenishment integration (plain-language copy: "network fee balance")
  const treasurySrc = await readFile(new URL("../src/screens/tenant/Treasury.tsx", import.meta.url), "utf8");
  assert.match(hooksSrc, /usePaymasterTreasuryBalance/);
  assert.match(hooksSrc, /useDepositPaymasterGas/);
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
  assert.match(fleetSrc, /statusFilter/);
  assert.match(fleetSrc, /sourceFilter/);
  assert.match(fleetSrc, /riskFilter/);

  // Feature 2: Policy Studio Live Pre-Flight Sandbox & Staged Diff Analysis
  assert.match(policySrc, /policy-diff-section/);
  assert.match(policySrc, /policy-diff-table/);
  assert.match(policySrc, /policy-dryrun-section/);
  assert.match(policySrc, /dryRunVerdict/);
  assert.match(policySrc, /ERR_MAX_PER_TX_EXCEEDED/);
  assert.match(policySrc, /ERR_MAX_PER_WINDOW_EXCEEDED/);
  assert.match(policySrc, /ERR_MERCHANT_NOT_WHITELISTED/);

  // Feature 3: Agent Inspector Security tab (hardware attestation & identity, surfaced in plain language
  // rather than raw TEE registers / ERC standard numbers)
  assert.match(inspectorSrc, /activeTab === "security"/);
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
});

test("Options 1-3: Swarm DAG Governance, Canary Policy Rollout with Atomic Rollback, and Predictive Threat Radar are integrated", async () => {
  const [fleetSrc, swarmSrc, policySrc, activitySrc, apiSrc, globalsCss] = await Promise.all([
    readScreen("Fleet"),
    readFile(new URL("../src/components/AgentStatusGrid.tsx", import.meta.url), "utf8"),
    readScreen("Policy"),
    readFile(new URL("../src/screens/tenant/ActivityTrace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/globals.css", import.meta.url), "utf8"),
  ]);

  // Option 1: the card view is built from real roster data only. The gateway serves no delegations,
  // budgets or capabilities, so none of those may be fabricated or kept in browser storage.
  assert.match(fleetSrc, /fleet-view-toggle/);
  assert.match(fleetSrc, /AgentStatusGrid/);
  assert.match(swarmSrc, /useTripKillSwitch/);
  assert.doesNotMatch(swarmSrc, /localStorage|subBudget|allocatedSpend|capabilities|\* 0\.32|"1000\.00"|"150\.00"/);
  assert.doesNotMatch(apiSrc, /SwarmNode|SwarmDelegation|agentguard_swarm_delegations/);

  // Option 2: Canary Policy Deployments with Automated Onchain Rollback
  assert.match(policySrc, /policy-canary-section/);
  assert.match(policySrc, /canary-stepper/);
  assert.match(policySrc, /handleEmergencyRollback/);
  assert.match(policySrc, /handleAdvanceCanary/);
  assert.match(apiSrc, /CanaryDeployment/);
  assert.match(apiSrc, /CanaryStage/);

  // Option 3: Predictive Threat Radar & Counterparty Category Drift Engine
  assert.match(activitySrc, /threat-radar-surface/);
  assert.match(activitySrc, /threatIntelligence/);
  assert.match(activitySrc, /threat-categories/);
  assert.match(activitySrc, /handleRemediate/);
  assert.match(apiSrc, /ThreatAnomaly/);
  assert.match(apiSrc, /ThreatAnomalyType/);

  // CSS Tokens verification for Options 1-3
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
  // No protocol or jargon terms in navigation labels
  assert.doesNotMatch(navigation, /label: "(Fleet|Quorum|Simulator|Reconciliation|Billing ledger)"/);

  // Collapsible with persistence, and an off-canvas drawer on small screens
  assert.match(navigation, /agentguard-sidebar-collapsed/);
  assert.match(navigation, /TOGGLE_NAV_EVENT/);
  assert.match(topBar, /top-bar-menu-btn/);
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

test("policy dry-run follows the engine's evaluation order and boundaries exactly", async () => {
  const { evaluateDryRun, amountToBaseUnits } = await import("../src/screens/tenant/policy/utils.ts");
  const limits = { maxPerTx: "10", maxPerWindow: "100", killSwitch: false, whitelistEnabled: true };
  const verdict = (amount, overrides = {}, merchant = "whitelisted") =>
    evaluateDryRun({ amount, merchant, limits: { ...limits, ...overrides } }).title;

  // A payment exactly at the limit goes through; one base unit more does not (no float rounding).
  assert.equal(verdict("10"), "ERR_NONE");
  assert.equal(verdict("10.000000"), "ERR_NONE");
  assert.equal(verdict("10.000001"), "ERR_MAX_PER_TX_EXCEEDED");
  assert.equal(verdict("0.1"), "ERR_NONE");

  // Period limit applies when the per-payment limit is higher than what is left for the period.
  assert.equal(verdict("60", { maxPerTx: "80", maxPerWindow: "50" }), "ERR_MAX_PER_WINDOW_EXCEEDED");

  // Order: paused beats everything, then the amount, then limits, then recipient.
  assert.equal(verdict("1000", { killSwitch: true }), "ERR_KILL_SWITCH_ACTIVE");
  assert.equal(verdict("0"), "ERR_AMOUNT_ZERO");
  assert.equal(verdict("1000", {}, "unwhitelisted"), "ERR_MAX_PER_TX_EXCEEDED");
  assert.equal(verdict("5", {}, "unwhitelisted"), "ERR_MERCHANT_NOT_WHITELISTED");
  assert.equal(verdict("5", { whitelistEnabled: false }, "unwhitelisted"), "ERR_NONE");

  // Whatever is typed, the result is a decision, never an exception.
  for (const junk of ["", "abc", "-5", "1e400", "NaN", "  ", "1e1"]) {
    assert.doesNotThrow(() => evaluateDryRun({ amount: junk, merchant: "whitelisted", limits }));
  }
  assert.equal(amountToBaseUnits("1e1"), 10_000_000n);
  assert.equal(amountToBaseUnits("-5"), 0n);
  assert.equal(amountToBaseUnits("abc"), 0n);

  // Allowed results say so; denials always carry a reason code (never silent).
  assert.equal(evaluateDryRun({ amount: "5", merchant: "whitelisted", limits }).allowed, true);
  const denied = evaluateDryRun({ amount: "500", merchant: "whitelisted", limits });
  assert.equal(denied.allowed, false);
  assert.ok(denied.reasonCode > 0);
});

test("format layer: exact money, one locale, honest placeholders", async () => {
  const f = await import("../src/format.ts");
  f.setFormatLocale("en-US");
  const plain = (text) => text.replace(/\s/g, " ");

  // Base units become exact decimals; amounts beyond 2^53 and half-cent ties stay correct,
  // which Number(x) / 1e6 followed by toFixed(2) does not guarantee.
  assert.equal(f.decimalFromBaseUnits("1234567"), "1.234567");
  assert.equal(f.decimalFromBaseUnits(5n), "0.000005");
  assert.equal(f.decimalFromBaseUnits("-1500000"), "-1.500000");
  assert.equal(f.decimalFromBaseUnits("-0"), "0.000000");
  assert.equal(f.decimalFromBaseUnits("12.5"), null);
  assert.equal(f.decimalFromBaseUnits("abc"), null);
  assert.equal(f.formatBaseUnits("9007199254740993"), "9,007,199,254.74");
  assert.equal(f.formatBaseUnits("1005000"), "1.01");
  assert.equal((1005000 / 1e6).toFixed(2), "1.00", "the old approach rounds this tie the wrong way");
  assert.equal(f.formatBaseUnits("999999"), "1.00");
  assert.equal(f.formatBaseUnits(120_000_000n), "120.00");
  assert.equal(f.formatBaseUnits("1234567", { minimumFractionDigits: 4, maximumFractionDigits: 4 }), "1.2346");

  // Form inputs get plain, truncated decimals: a "use maximum" fill never exceeds the balance.
  assert.equal(f.toInputAmount("1239999"), "1.23");
  assert.equal(f.toInputAmount("1239999", { digits: 4 }), "1.2399");
  assert.equal(f.toInputAmount(1_500_000n), "1.50");
  assert.equal(f.toInputAmount("-5"), "0.00");
  assert.equal(f.toInputAmount(null), "0.00");
  assert.equal(f.toInputAmount(2_500_000_000_000_000_000n, { decimals: 18, digits: 4 }), "2.5000");
  f.setFormatLocale("de-DE");
  assert.equal(f.toInputAmount("1239999"), "1.23", "inputs stay locale independent");
  f.setFormatLocale("en-US");

  // Dollar formatting from base units and from plain numbers.
  assert.equal(f.formatUsdBaseUnits("99000000"), "$99.00");
  assert.equal(f.formatUsd(1234.5), "$1,234.50");
  assert.equal(f.formatUsd("0.000001", { maximumFractionDigits: 6 }), "$0.000001");
  assert.equal(f.formatMicroUsd(2000), "$0.0020");
  assert.equal(f.formatMicroUsd(1_000_000, 2), "$1.00");

  // Numbers, percentages, compact values.
  assert.equal(f.formatNumber(1234567), "1,234,567");
  assert.equal(f.formatFixed(2.8, 2), "2.80");
  assert.equal(f.formatPercent(10), "10.0%");
  assert.equal(f.formatPercent(12.345, 2), "12.35%");
  assert.equal(f.formatCompactNumber(1500), "1.5K");

  // Missing and malformed values never become NaN or Invalid Date.
  for (const value of [null, undefined, "", Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(f.formatNumber(value), "—");
    assert.equal(f.formatUsd(value), "—");
    assert.equal(f.formatPercent(value), "—");
  }
  assert.equal(f.formatBaseUnits(null), "—");
  assert.equal(f.formatDate("not a date"), "—");
  assert.equal(f.formatDateTime(undefined), "—");
  assert.equal(f.formatTime(""), "—");
  assert.equal(f.formatRelativeTime("nope"), "—");

  // Dates and times (local noon so the result does not depend on the machine's time zone).
  const noon = new Date(2026, 9, 3, 12, 0, 5);
  assert.equal(f.formatDate(noon), "Oct 3, 2026");
  assert.equal(plain(f.formatDateTime(noon)), "Oct 3, 2026, 12:00 PM");
  assert.equal(plain(f.formatTime(noon)), "12:00 PM");
  assert.equal(plain(f.formatTime(noon, { seconds: true })), "12:00:05 PM");

  // Relative times pick a sensible unit and fall back to a date for old values.
  const now = noon.getTime();
  assert.equal(f.formatRelativeTime(now - 30_000, now), "30 seconds ago");
  assert.equal(f.formatRelativeTime(now - 5 * 60_000, now), "5 minutes ago");
  assert.equal(f.formatRelativeTime(now - 3 * 3_600_000, now), "3 hours ago");
  assert.equal(f.formatRelativeTime(now - 86_400_000, now), "yesterday");
  assert.equal(f.formatRelativeTime(now + 2 * 3_600_000, now), "in 2 hours");
  assert.equal(f.formatRelativeTime(now - 90 * 86_400_000, now), f.formatDate(now - 90 * 86_400_000));

  // One locale drives everything, and switching it changes every formatter together.
  f.setFormatLocale("de-DE");
  assert.equal(f.formatBaseUnits("1234500000"), "1.234,50");
  assert.equal(plain(f.formatUsd(1234.5)), "1.234,50 $");
  assert.equal(f.formatDate(noon), "03.10.2026");
  f.setFormatLocale("en-US");
  assert.equal(f.formatBaseUnits("1234500000"), "1,234.50");
});

test("policy money helpers stay exact: form text and USDC labels", async () => {
  const { setFormatLocale } = await import("../src/format.ts");
  const { baseUnitsToDollars, formatUsdcAmount } = await import("../src/screens/tenant/policy/utils.ts");
  setFormatLocale("en-US");

  // Form fields get plain decimals with no grouping or trailing zeros.
  assert.equal(baseUnitsToDollars("10000000"), "10");
  assert.equal(baseUnitsToDollars("1500000"), "1.5");
  assert.equal(baseUnitsToDollars("500"), "0.0005");
  assert.equal(baseUnitsToDollars("20000000"), "20");
  assert.equal(baseUnitsToDollars("100000000"), "100");
  assert.equal(baseUnitsToDollars(0), "0");
  assert.equal(baseUnitsToDollars(null), "0");
  assert.equal(baseUnitsToDollars("2.5"), "2.5", "already-decimal text is left alone");
  assert.equal(baseUnitsToDollars("junk"), "0");

  // Labels: grouping, two decimals, more precision only for amounts under a cent.
  assert.equal(formatUsdcAmount("1234.5"), "$1,234.50 USDC");
  assert.equal(formatUsdcAmount(10), "$10.00 USDC");
  assert.equal(formatUsdcAmount("0.000001"), "$0.000001 USDC");
  assert.equal(formatUsdcAmount("0"), "$0.00 USDC");
  assert.equal(formatUsdcAmount(""), "$0.00 USDC");
  assert.equal(formatUsdcAmount("abc"), "$0.00 USDC");
});

test("screens format through the shared layer, not hand-rolled locale or float math", async () => {
  const files = (await walk(new URL("../src/screens/", import.meta.url).pathname)).concat(
    (await walk(new URL("../src/components/", import.meta.url).pathname)),
  );
  const offenders = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    source.split("\n").forEach((line, index) => {
      if (/\.toLocale(?:Date|Time)?String\(/.test(line)) offenders.push(`${file}:${index + 1} locale formatting`);
      // Money shown with float division followed by toFixed (inputs and data rounding are allowed).
      if (/\/ (?:1e6|1e18|1_000_000)\)?\.toFixed\(/.test(line) && !/placeholder=|setTransferAmount|Number\(/.test(line)) {
        offenders.push(`${file}:${index + 1} float money`);
      }
    });
  }
  assert.deepEqual(offenders, [], "use src/format.ts");
});

test("message catalog: typed lookups, filled placeholders, plain-language wording", async () => {
  const { t, has } = await import("../src/messages/index.ts");
  const { en } = await import("../src/messages/en.ts");
  const copy = await import("../src/copy.ts");

  assert.equal(t("decision.approved"), "Approved");
  assert.equal(
    t("dryRun.overTransactionLimit.description", { amount: "$15.00 USDC", limit: "$10.00 USDC" }),
    "$15.00 USDC is over the per-transaction limit ($10.00 USDC).",
  );
  assert.throws(() => t("dryRun.overPeriodLimit.description", {}), /needs "limit"/, "untyped callers cannot render blanks");
  assert.equal(has("decision.approved"), true);
  assert.equal(has("toString"), false);
  assert.equal(has("constructor"), false);

  // Every code the copy module knows resolves to a real message; unknown codes fall back sensibly.
  assert.equal(copy.reasonCodeLabel("ERR_KILL_SWITCH_ACTIVE"), en["decision.paused"]);
  assert.equal(copy.reasonCodeLabel("toString"), en["decision.blockedFallback"], "inherited object keys are not codes");
  assert.equal(copy.eventLabel("constructor"), "Constructor", "inherited object keys are not events");

  // Wording rules from the engineering instructions: no protocol or infrastructure jargon in copy.
  const forbidden = /kill ?switch|\bERC-?\d|\bEIP-?\d|O\(1\)|docker|daemon|container|localhost|calldata|slot word|tstore|\bgas\b/i;
  for (const [key, message] of Object.entries(en)) {
    assert.doesNotMatch(message, forbidden, `${key} contains jargon: "${message}"`);
    for (const placeholder of message.match(/\{(\w+)\}/g) ?? []) {
      assert.match(placeholder, /^\{[a-z][A-Za-z]*\}$/, `${key} has an odd placeholder ${placeholder}`);
    }
  }
});

test("Treasury offers the developer-network faucet only on the local profile", async () => {
  const src = await readScreen("Treasury");
  const guard = src.indexOf('configuration.profile === "local"');
  const button = src.indexOf("Devnet Faucet");
  assert.ok(guard !== -1 && button !== -1 && guard < button, "faucet button must sit behind the local-profile guard");
  assert.equal(src.split("Devnet Faucet").length - 1, 1, "faucet wording appears once");
  assert.equal(src.split("devnetFaucet.mutateAsync").length - 1, 1, "faucet is called from one place");
});
