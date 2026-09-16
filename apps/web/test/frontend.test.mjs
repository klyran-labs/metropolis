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
  assert.match(signin, /EIP-712 Signed/);
  assert.match(signin, /Non-Custodial/);
  assert.match(signin, /Hardware Sealed/);

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
    readFile(new URL("../src/screens/tenant/Fleet.tsx", import.meta.url), "utf8"),
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
});

test("Phase 2 UI/UX Invariants: dynamic storage slots, Policy Studio presets, and merchant copying", async () => {
  const [inspector, policy, merchantDir, quorum, simulator] = await Promise.all([
    readFile(new URL("../src/screens/tenant/AgentInspector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/screens/tenant/Policy.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/screens/tenant/MerchantDirectory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/screens/tenant/QuorumApprovals.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/screens/tenant/PolicySimulator.tsx", import.meta.url), "utf8"),
  ]);

  // AgentInspector zero-mock invariant: no hardcoded 28% velocity or static 100.00 USDC in slot
  assert.doesNotMatch(inspector, /28% of hourly cap/);
  assert.match(inspector, /useAgentPolicy/);
  assert.match(inspector, /maxSpendPerTxFormatted/);
  assert.match(inspector, /windowDurationFormatted/);

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





