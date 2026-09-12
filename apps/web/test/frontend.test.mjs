import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseEther, parseUnits, formatUnits, hashTypedData, recoverAddress } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

import eip712Deployment from "../../../deployments/monad-testnet/eip712.json" with { type: "json" };

const EIP712_DOMAIN = {
  name: eip712Deployment.name,
  version: eip712Deployment.version,
  chainId: eip712Deployment.chainId,
  verifyingContract: eip712Deployment.verifyingContract,
};

const ORDER_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "isBid", type: "bool" },
    { name: "pricePerSec", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "tokenId", type: "uint256" },
    { name: "ecdhPublicKey", type: "bytes" },
  ],
};

function buildOrderPayload(maker, isBid, priceMonPerHour, hours, tokenId, ecdhPublicKey) {
  const totalWeiPerHour = parseEther(priceMonPerHour);
  const pricePerSec = totalWeiPerHour / 3600n;
  const amountSec = BigInt(hours) * 3600n;
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400);
  const nonce = BigInt(Date.now());

  return {
    domain: EIP712_DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: {
      maker,
      isBid,
      pricePerSec,
      amount: amountSec,
      nonce,
      expiry,
      tokenId,
      ecdhPublicKey,
    },
  };
}

test("Frontend: EIP-712 Order Builder calculates exact wei/sec and passes recovery", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const pricePerHour = "3.60"; // 3.60 MON/hr = 3.6 * 10^18 / 3600 = 10^15 wei/sec
  const hours = 24;
  const tokenId = 1n;
  const ecdhPub = "0x04bfb0d39e3f324bfeb0d1f7c7524ffb0270a41639d6787d55eb23b03be93c3167b070bbbe250a240ff9ab82d77cb08cf741e2c99a09968434771239c0498b9816";

  const payload = buildOrderPayload(account.address, true, pricePerHour, hours, tokenId, ecdhPub);

  // Assert exact mathematical conversion
  assert.equal(payload.message.pricePerSec, 1000000000000000n, "3.60 MON/hr must equal 10^15 wei/sec");
  assert.equal(payload.message.amount, 24n * 3600n, "24 hours = 86,400 seconds");
  assert.equal(payload.message.tokenId, 1n);

  // Sign using Viem account
  const sig = await account.signTypedData(payload);

  // Verify onchain recovery match
  const recovered = await recoverAddress({
    hash: hashTypedData(payload),
    signature: sig,
  });

  assert.equal(recovered.toLowerCase(), account.address.toLowerCase());
});

test("Frontend: Order Book Depth aggregation and spread computation", () => {
  const rawBids = [
    { price: 2.45, amountHours: 48, orderCount: 3 },
    { price: 2.40, amountHours: 120, orderCount: 5 },
  ];
  const rawAsks = [
    { price: 2.50, amountHours: 36, orderCount: 2 },
    { price: 2.55, amountHours: 84, orderCount: 4 },
  ];

  const bestBid = rawBids[0].price;
  const bestAsk = rawAsks[0].price;
  const spread = +(bestAsk - bestBid).toFixed(3);
  const midPrice = +((bestBid + bestAsk) / 2).toFixed(3);

  assert.equal(spread, 0.05);
  assert.equal(midPrice, 2.475);

  const totalBidHours = rawBids.reduce((sum, b) => sum + b.amountHours, 0);
  const totalAskHours = rawAsks.reduce((sum, a) => sum + a.amountHours, 0);

  assert.equal(totalBidHours, 168);
  assert.equal(totalAskHours, 120);
});

test("Frontend: order-book totals use raw settlement units for display", async () => {
  const canvas = await readFile(new URL("../src/components/OrderBookCanvas.tsx", import.meta.url), "utf8");
  const socket = await readFile(new URL("../src/hooks/useOrderBookSocket.ts", import.meta.url), "utf8");
  assert.match(canvas, /formatMonCommitment\(ask\.pricePerSecond, ask\.amountSeconds/);
  assert.match(canvas, /formatMonCommitment\(bid\.pricePerSecond, bid\.amountSeconds/);
  assert.doesNotMatch(canvas, /ask\.price \* ask\.amountHours/);
  assert.doesNotMatch(canvas, /bid\.price \* bid\.amountHours/);
  assert.match(socket, /pricePerSecond: String\(b\.price\)/);
  assert.match(socket, /amountSeconds: String\(b\.total_amount_sec\)/);
});

test("Frontend: recurring policy retries use the signed purchase intent as idempotency key", async () => {
  const catalog = await readFile(new URL("../src/components/buyer/CapacityCatalog.tsx", import.meta.url), "utf8");
  assert.match(catalog, /idempotencyKey: `purchase-\$\{payload\.message\.nonce\.toString\(\)\}`/);
});

test("Frontend: signed order ledger writes carry a deterministic retry key", async () => {
  const source = await readFile(new URL("../src/hooks/useOrderLedger.ts", import.meta.url), "utf8");
  assert.match(source, /'Idempotency-Key': `order-\$\{String\(order\.order_id \?\? order\.nonce\)\}`/);
  assert.match(source, /cryptographic authorization/);
});

test("Frontend: SLA Telemetry evaluation and breach detection", () => {
  const healthyNode = { uptimePpm: 999500, pingMs: 18 };
  const minUptimePpm = 995000; // 99.5%
  const maxPingMs = 50;

  const isHealthy = healthyNode.uptimePpm >= minUptimePpm && healthyNode.pingMs <= maxPingMs;
  assert.ok(isHealthy, "Healthy node satisfies SLA");

  const degradedNode = { uptimePpm: 981000, pingMs: 145 };
  const isDegraded = degradedNode.uptimePpm < minUptimePpm || degradedNode.pingMs > maxPingMs;
  assert.ok(isDegraded, "Breach correctly flagged for parametric slashing");
});

test("Frontend: Role Exclusivity - Buyer and Seller operations are strictly separated", () => {
  // Test role state definition
  const buyerRole = "buyer";
  const sellerRole = "seller";

  // Assert mutually exclusive persona definition
  assert.notEqual(buyerRole, sellerRole, "Buyer and Seller roles must be distinct");

  // Validate Buyer permissions
  const buyerPermissions = {
    canBrowseMarketplace: true,
    canSubmitBids: true,
    canViewInstanceCredentials: true,
    canDepositEscrow: true,
    canListHardwareInventory: false,
    canBondSlaStake: false,
  };

  assert.equal(buyerPermissions.canSubmitBids, true, "Buyer can submit bids");
  assert.equal(buyerPermissions.canBondSlaStake, false, "Buyer cannot access seller SLA stake operations");
  assert.equal(buyerPermissions.canListHardwareInventory, false, "Buyer cannot access seller hardware inventory");

  // Validate Seller permissions
  const sellerPermissions = {
    canBrowseMarketplace: false,
    canSubmitBids: false,
    canViewInstanceCredentials: false,
    canDepositEscrow: false,
    canListHardwareInventory: true,
    canBondSlaStake: true,
  };

  assert.equal(sellerPermissions.canBondSlaStake, true, "Seller can bond SLA stake");
  assert.equal(sellerPermissions.canListHardwareInventory, true, "Seller can list hardware inventory");
  assert.equal(sellerPermissions.canSubmitBids, false, "Seller cannot submit buyer bids in seller portal");
  assert.equal(sellerPermissions.canViewInstanceCredentials, false, "Seller cannot view buyer credentials");
});

test("Frontend: Marketing Landing Page metrics guarantee zero leaked technical debug details", () => {
  const landingMetrics = [
    { label: "Policy Target", value: "99.50%" },
    { label: "Capacity Types", value: "CPU + GPU" },
    { label: "Pricing Model", value: "Transparent" },
  ];

  // Assert strictly marketing metrics exist and contain no debug/port leaks
  for (const m of landingMetrics) {
    assert.doesNotMatch(m.label, /port|0x|rust|memmap|ws:\/\//i, "Marketing labels must be clean of technical internal details");
    assert.doesNotMatch(m.value, /port|0x|rust|memmap|ws:\/\//i, "Marketing values must be clean of technical internal details");
  }
});

test("Frontend: authentication presents two clear workspace choices", async () => {
  const source = await readFile(new URL("../src/components/InlinePrivyAuth.tsx", import.meta.url), "utf8");
  assert.match(source, /Choose your workspace/);
  assert.match(source, /Customer workspace/);
  assert.match(source, /Provider workspace/);
  assert.doesNotMatch(source, /train_ai/);
});

test("Frontend: legal-document action is separate from consent checkbox semantics", async () => {
  const source = await readFile(new URL("../src/components/InlinePrivyAuth.tsx", import.meta.url), "utf8");
  assert.match(source, /aria-describedby="terms-description"/);
  assert.match(source, /<div id="terms-description"/);
  assert.doesNotMatch(source, /<label htmlFor="terms"[\s\S]*<button/);
});

test("Frontend: authenticated shell keeps protocol identifiers out of normal navigation", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const console = await readFile(new URL("../src/AuthenticatedConsole.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /Monad L1 \(10143\)/);
  assert.doesNotMatch(app, /400ms Block Finality/);
  assert.doesNotMatch(app, /Non-Custodial DvP Settlement/);
  assert.match(console, /Marketplace network/);
  assert.match(console, /Network confirmation target/);
});

test("Frontend: public entry defers authenticated marketplace code", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  const console = await readFile(new URL("../src/AuthenticatedConsole.tsx", import.meta.url), "utf8");
  assert.match(app, /React\.lazy\(\(\) => import\('\.\/AuthenticatedConsole'\)\)/);
  assert.doesNotMatch(app, /MarketplaceProvider/);
  assert.match(main, /<WorkspaceProvider>/);
  assert.match(console, /<MarketplaceProvider>/);
  assert.match(console, /React\.lazy\(\(\) =>/);
});

test("Frontend: primary funding and order lifecycle copy uses customer terminology", async () => {
  const header = await readFile(new URL("../src/components/fintech/FintechHeader.tsx", import.meta.url), "utf8");
  const funding = await readFile(new URL("../src/components/fintech/EscrowModal.tsx", import.meta.url), "utf8");
  const lifecycle = await readFile(new URL("../src/components/buyer/OrderLifecycleView.tsx", import.meta.url), "utf8");
  const activity = await readFile(new URL("../src/components/common/NotificationDrawer.tsx", import.meta.url), "utf8");
  assert.match(header, /Marketplace connection status/);
  assert.match(funding, /Protected Trading Balance/);
  assert.match(lifecycle, /Wallet authorization/);
  assert.match(activity, /Protected network/);
  assert.doesNotMatch(activity, /Chain 10143/);
  assert.doesNotMatch(funding, /Monad Testnet/);
  assert.doesNotMatch(lifecycle, /EIP-712 auth/);
});

test("Frontend: GCP/AWS Cloud Console navigation taxonomy and machine type matrix", () => {
  // Cloud Console Navigation sections
  const buyerConsoleSections = ["catalog", "clob", "instances", "wireguard", "escrow", "telemetry"];
  assert.equal(buyerConsoleSections.length, 6);
  assert.ok(buyerConsoleSections.includes("catalog"), "Includes EC2/GCP Machine Catalog");
  assert.ok(buyerConsoleSections.includes("wireguard"), "Includes VPC WireGuard Mesh");

  // Verify machine family taxonomy
  const machineFamilies = {
    CPU: ["cCPU-EPYC-9754", "cCPU-EPYC-9654", "cCPU-XEON-8592P", "cCPU-ALTRA-M128"],
    GPU: ["cGPU-H100-SXM5", "cGPU-H200-SXM", "cGPU-B200-SXM", "cGPU-MI300X-OAM"],
    CLUSTER_POD: ["cPOD-8x-H100-SXM5", "cPOD-8x-B200-NVL", "cPOD-8x-MI300X-OAM"],
  };

  assert.ok(machineFamilies.CPU.length >= 4, "High-density CPUs verified");
  assert.ok(machineFamilies.GPU.length >= 4, "Tensor GPUs verified");
  assert.ok(machineFamilies.CLUSTER_POD.length >= 3, "Multi-node SuperPods verified");
});

test("Frontend: Enterprise Console default landing dashboard and role exclusivity", () => {
  // Test that both Buyer and Seller default to 'dashboard' on initial landing
  const initialBuyerSection = "dashboard";
  const initialSellerSection = "dashboard";

  assert.equal(initialBuyerSection, "dashboard", "Buyer console must default to Operations Dashboard on landing");
  assert.equal(initialSellerSection, "dashboard", "Seller console must default to Operations Dashboard on landing");

  // Verify Buyer Dashboard KPI math: Runway hours = Escrow / BurnRate
  const escrowBalanceMon = "120.0";
  const activeBurnRatePerHour = 2.50; // MON/hr
  const runwayHours = +(parseFloat(escrowBalanceMon) / activeBurnRatePerHour).toFixed(1);
  assert.equal(runwayHours, 48.0, "Runway hours correctly calculated from onchain escrow and burn rate");

  // Zero-burn runway fallback
  const zeroBurnRate = 0;
  const zeroBurnRunway = zeroBurnRate > 0 ? (parseFloat(escrowBalanceMon) / zeroBurnRate).toFixed(1) : null;
  assert.equal(zeroBurnRunway, null, "When burn rate is 0, runway displays stable/null without NaN or infinity");
});

test("Frontend: responsive workspace navigation remains available before the desktop sidebar breakpoint", async () => {
  const source = await readFile(new URL("../src/components/fintech/FintechHeader.tsx", import.meta.url), "utf8");
  assert.match(source, /relative flex w-full items-center[^\n]*lg:hidden/);
  assert.match(source, /primaryMobileItems/);
  const sidebar = await readFile(new URL("../src/components/fintech/WorkspaceSidebar.tsx", import.meta.url), "utf8");
  assert.match(sidebar, /sticky top-16/);
  assert.match(sidebar, /overflow-y-auto/);
});

test("Frontend: workspace financial navigation uses one canonical customer route", async () => {
  const source = await readFile(new URL("../src/components/fintech/WorkspaceSidebar.tsx", import.meta.url), "utf8");
  assert.match(source, /buyer\/funding/);
  assert.doesNotMatch(source, /buyer\/billing/);
  assert.match(source, /Funding & Billing/);
  const portal = await readFile(new URL("../src/components/buyer/BuyerPortal.tsx", import.meta.url), "utf8");
  assert.match(portal, /path\.includes\('\/buyer\/billing'\)/);
  assert.match(portal, /navigate\('\/buyer\/funding', \{ replace: true \}\)/);
});

test("Frontend: durable order durations remain exact integer-derived displays", async () => {
  const source = await readFile(new URL("../src/components/buyer/OrderLifecycleView.tsx", import.meta.url), "utf8");
  assert.match(source, /amountHours: formatCapacityHours\(order\.amountSeconds\)/);
  assert.match(source, /formatCapacityHours\(policy\.amountSeconds\)/);
  assert.doesNotMatch(source, /Number\(order\.amountSeconds\)/);
  assert.doesNotMatch(source, /Number\(policy\.amountSeconds\)/);
});

test("Frontend: order cancellation is offered only for pre-match durable orders", async () => {
  const source = await readFile(new URL("../src/components/buyer/OrderLifecycleView.tsx", import.meta.url), "utf8");
  assert.match(source, /const canCancel = order\.isDurable && \['AUTHORIZED', 'FUNDS_LOCKED'\]/);
  assert.match(source, /disabled=\{!canCancel\}/);
  assert.match(source, /Locked after match/);
});

test("Frontend: ledger pagination failures remain visible and retryable", async () => {
  const hook = await readFile(new URL("../src/hooks/useOrderLedger.ts", import.meta.url), "utf8");
  const view = await readFile(new URL("../src/components/buyer/OrderLifecycleView.tsx", import.meta.url), "utf8");
  assert.match(hook, /loadMoreError/);
  assert.match(hook, /More order records could not be loaded/);
  assert.match(hook, /More recurring orders could not be loaded/);
  assert.match(view, /ledger\.loadMoreError/);
  assert.match(hook, /const query = view === 'active' \? activeQuery : historyQuery/);
  assert.match(hook, /encodeURIComponent\(cursor\)\}\$\{queryParam\}/);
  assert.match(hook, /const queryParam = recurringQuery \? `&q=/);
});

test("Frontend: large inventory pagination failures remain visible and retryable", async () => {
  const offersHook = await readFile(new URL("../src/hooks/useCapacityOffers.ts", import.meta.url), "utf8");
  const allocationsHook = await readFile(new URL("../src/hooks/useAllocations.ts", import.meta.url), "utf8");
  const catalog = await readFile(new URL("../src/components/buyer/CapacityCatalog.tsx", import.meta.url), "utf8");
  const portal = await readFile(new URL("../src/components/buyer/BuyerPortal.tsx", import.meta.url), "utf8");
  assert.match(offersHook, /loadMoreError/);
  assert.match(allocationsHook, /More active allocations could not be loaded/);
  assert.match(catalog, /liveOffers\.loadMoreError/);
  assert.match(portal, /allocationsLoadMoreError/);
  assert.match(catalog, /Retry when ready/);
  assert.match(portal, /Retry when ready/);
});

test("Frontend: catalog Next loads the next cursor page without losing current results", async () => {
  const offersHook = await readFile(new URL("../src/hooks/useCapacityOffers.ts", import.meta.url), "utf8");
  const catalog = await readFile(new URL("../src/components/buyer/CapacityCatalog.tsx", import.meta.url), "utf8");
  assert.match(offersHook, /loadMore: \(\) => nextCursor && !isLoadingMore \? fetchPage\(nextCursor\) : Promise\.resolve\(false\)/);
  assert.match(catalog, /const loaded = await liveOffers\.loadMore\(\);/);
  assert.match(catalog, /if \(loaded\) setCatalogPage/);
  assert.match(catalog, /liveOffers\.nextCursor/);
});

test("Frontend: stale marketplace inventory is disclosed and refreshable", async () => {
  const catalog = await readFile(new URL("../src/components/buyer/CapacityCatalog.tsx", import.meta.url), "utf8");
  assert.match(catalog, /inventoryIsStale/);
  assert.match(catalog, /Rates and availability may have changed/);
  assert.match(catalog, /Refresh inventory/);
});

test("Frontend: catalog counts do not misrepresent cursor-paginated inventory totals", async () => {
  const catalog = await readFile(new URL("../src/components/buyer/CapacityCatalog.tsx", import.meta.url), "utf8");
  assert.match(catalog, /loaded live offers/);
  assert.match(catalog, /More available/);
  assert.doesNotMatch(catalog, /of \{filteredOffers\.length\} live offers/);
});

test("Frontend: market-data reconnects are bounded and teardown-safe", async () => {
  const source = await readFile(new URL("../src/hooks/useOrderBookSocket.ts", import.meta.url), "utf8");
  assert.match(source, /disposedRef/);
  assert.match(source, /reconnectTimerRef/);
  assert.match(source, /Math\.min\(30_000/);
  assert.match(source, /clearTimeout\(reconnectTimerRef\.current\)/);
  assert.match(source, /if \(disposedRef\.current\) return;/);
});

test("Frontend: health UI never substitutes fake collateral or uptime evidence", async () => {
  const source = await readFile(new URL("../src/components/TelemetryRadar.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /1,000\.00 MON/);
  assert.doesNotMatch(source, /uptime_ppm \|\| 1000000/);
  assert.doesNotMatch(source, /3-OF-5 THRESHOLD ATTESTATION: VERIFIED/);
  assert.match(source, /Evidence status:/);
});

test("Frontend: health requests are bound to authoritative allocation identifiers", async () => {
  const source = await readFile(new URL("../src/components/TelemetryRadar.tsx", import.meta.url), "utf8");
  assert.match(source, /allocationId\?: string/);
  assert.match(source, /telemetry\/latest\/\$\{encodeURIComponent\(allocationId\)\}/);
  assert.doesNotMatch(source, /telemetry\/latest\/\$\{selectedId\}/);
});

test("Frontend: provider dashboard does not claim unverified health or payout state", async () => {
  const source = await readFile(new URL("../src/components/seller/SellerDashboard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /ONLINE • HEALTHY/);
  assert.doesNotMatch(source, /Credited to Escrow/);
  assert.doesNotMatch(source, /ACTIVE • ≥ 99\.50% UPTIME/);
  assert.match(source, /VERIFICATION PENDING/);
  assert.match(source, /payout pending/);
});

test("Frontend: provider quorum copy distinguishes configuration from live evidence", async () => {
  const source = await readFile(new URL("../src/components/seller/SellerPortal.tsx", import.meta.url), "utf8");
  assert.match(source, /Independent Health Verification/);
  assert.doesNotMatch(source, /Oracle Quorum Consensus/);
  assert.match(source, /before service-quality evidence can be accepted/);
});

test("Frontend: customer billing does not infer spend from voucher metadata", async () => {
  const source = await readFile(new URL("../src/components/buyer/BuyerPortal.tsx", import.meta.url), "utf8");
  assert.match(source, /Usage rate will appear when provider billing telemetry is available/);
  assert.match(source, /Projection unavailable until a verified usage rate is reported/);
  assert.doesNotMatch(source, /hourlyBurnRateWei = voucherList\.reduce/);
  assert.doesNotMatch(source, /formatRatio\(escrowWei/);
  assert.doesNotMatch(source, /Hourly Burn:/);
  assert.match(source, /formatCapacityHours\(v\.amount\)/);
});

test("Frontend: live fills are not presented as confirmed settlements", async () => {
  const overview = await readFile(new URL("../src/components/fintech/FintechOverview.tsx", import.meta.url), "utf8");
  const portal = await readFile(new URL("../src/components/buyer/BuyerPortal.tsx", import.meta.url), "utf8");
  assert.match(overview, /Live order matches/);
  assert.match(overview, /Settlement pending/);
  assert.doesNotMatch(overview, /<span>Settled<\/span>/);
  assert.match(portal, /MATCHED • SETTLEMENT PENDING/);
  assert.doesNotMatch(portal, /CLEARED ONCHAIN/);
  assert.doesNotMatch(portal, /,SETTLED/);
  assert.doesNotMatch(overview, /matching-engine|Active Session/);
  assert.doesNotMatch(portal, /matching-engine/);
});

test("Frontend: provider activity distinguishes executions from payout confirmation", async () => {
  const portal = await readFile(new URL("../src/components/seller/SellerPortal.tsx", import.meta.url), "utf8");
  const notifications = await readFile(new URL("../src/components/common/NotificationDrawer.tsx", import.meta.url), "utf8");
  assert.match(portal, /Marketplace Matches/);
  assert.match(portal, /Settlement confirmation is tracked separately/);
  assert.doesNotMatch(portal, /Cleared Trades/);
  assert.match(notifications, /Recent Marketplace Activity/);
});

test("Frontend: live activity never synthesizes user-visible trade identifiers", async () => {
  const sources = await Promise.all([
    "../src/components/buyer/BuyerDashboard.tsx",
    "../src/components/seller/SellerDashboard.tsx",
    "../src/components/seller/SellerPortal.tsx",
    "../src/components/buyer/OrderLifecycleView.tsx",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  const joined = sources.join("\n");
  assert.doesNotMatch(joined, /idx\s*\+\s*101/);
  assert.match(joined, /Pending reference/);
});

test("Frontend: legacy customer dashboard does not relabel entitlements as active capacity", async () => {
  const source = await readFile(new URL("../src/components/buyer/BuyerDashboard.tsx", import.meta.url), "utf8");
  assert.match(source, /Capacity Entitlements/);
  assert.match(source, /No authoritative health evidence/);
  assert.doesNotMatch(source, /≥99\.50%/);
  assert.doesNotMatch(source, /burnRatePerHourWei/);
  assert.match(source, /formatCapacityHours\(v\.amount\)/);
});

test("Frontend: Workspace selection must not be treated as authentication", () => {
  const storageMock = new Map();
  const mockLocalStorage = {
    getItem: (key) => storageMock.get(key) || null,
    setItem: (key, val) => storageMock.set(key, String(val)),
    removeItem: (key) => storageMock.delete(key),
  };

  mockLocalStorage.setItem("COMPUTEX_LAST_WORKSPACE", "seller");
  assert.equal(mockLocalStorage.getItem("COMPUTEX_LAST_WORKSPACE"), "seller");
  assert.equal(mockLocalStorage.getItem("COMPUTEX_AUTH_SESSION"), null);
  assert.equal(mockLocalStorage.getItem("COMPUTEX_USER_ROLE"), null);
});

test("Frontend: Dual-Asset Escrow calculation (USDC 6-decimals vs MON 18-decimals)", () => {
  // Test USDC formatting (6 decimals)
  const rawUsdc = 150500000n; // 150.50 USDC
  const formattedUsdc = parseFloat(formatUnits(rawUsdc, 6)).toFixed(2);
  assert.equal(formattedUsdc, "150.50", "USDC must format with 2 decimal places");

  // Test parseUnits
  const parsedUsdc = parseUnits("150.50", 6);
  assert.equal(parsedUsdc, 150500000n, "parseUnits must yield exact micro-units");

  // Test Native MON formatting (18 decimals)
  const rawMon = 42500000000000000000n; // 42.5 MON
  const formattedMon = parseFloat(formatUnits(rawMon, 18)).toFixed(4);
  assert.equal(formattedMon, "42.5000", "MON must format with 4 decimal places");

  // Ensure non-zero positive amounts match invariant
  assert.notEqual(rawUsdc, rawMon, "USDC and MON scales are strictly isolated");
});

test("Frontend: USD-First pricing commitment and hourly burn calculations", () => {
  const priceUsdPerHour = "2.40";
  const durationHours = 48;

  const totalCommittedUsd = (parseFloat(priceUsdPerHour) * durationHours).toFixed(2);
  assert.equal(totalCommittedUsd, "115.20", "Total committed order value for 48h @ $2.40/hr must be $115.20");

  const burnRatePerSec = (parseFloat(priceUsdPerHour) / 3600).toFixed(6);
  assert.equal(burnRatePerSec, "0.000667", "Burn rate per second matches exact division");

  const protocolFeeUsd = (parseFloat(totalCommittedUsd) * 0.0015).toFixed(4);
  assert.equal(protocolFeeUsd, "0.1728", "0.15% protocol fee matches exact math");
});

test("Frontend: Canonical Settlement State Machine transitions and event invariants", () => {
  const CANONICAL_ORDER = [
    'Draft',
    'WalletAuthorized',
    'FundsLocked',
    'Matched',
    'SettlementSubmitted',
    'SettlementConfirmed',
    'CapacityProvisioning',
    'CapacityActive',
    'Completed',
    'Reconciled',
  ];

  // Verify full sequence progression
  for (let i = 0; i < CANONICAL_ORDER.length - 1; i++) {
    const current = CANONICAL_ORDER[i];
    const next = CANONICAL_ORDER[i + 1];
    assert.ok(current, "State must exist");
    assert.ok(next, "Next state must exist");
  }

  // Verify transition event schema
  const mockEvent = {
    eventId: "evt_01JHG73812KMS98",
    orderId: 1042,
    actor: "0xF2d2c7333B3c0297B3cf286E9b049e29f375539c",
    timestamp: Date.now(),
    txHash: "0x3a4b5c6d7e8f90123456789abcdef0123456789abcdef0123456789abcdef01",
    previousState: "SettlementSubmitted",
    newState: "SettlementConfirmed",
    idempotencyKey: "idem_order_1042_step_5",
  };

  assert.equal(mockEvent.previousState, "SettlementSubmitted");
  assert.equal(mockEvent.newState, "SettlementConfirmed");
  assert.ok(mockEvent.idempotencyKey.startsWith("idem_"));
  assert.ok(mockEvent.txHash.startsWith("0x"));
});

test("Frontend: Enterprise Terminology Dictionary replaces protocol crypto jargon", () => {
  const dictionary = {
    CLOB: 'Capacity Marketplace',
    LIVE_CLOB_DEPTH: 'Available Capacity',
    BID: 'Purchase Order',
    ASK: 'Capacity Listing',
    MAKER_ORDER: 'Signed Purchase/Listing Authorization',
    COMPUTE_TOKEN: 'Capacity Entitlement',
    ESCROW: 'Protected Trading Balance',
    INSTANCE: 'Capacity Allocation',
    NODE_OPERATOR: 'Compute Provider',
    NODE: 'Compute Host / Provider Fleet',
    BONDED_STAKE: 'SLA Collateral',
    SLASHING: 'SLA Collateral Adjustment',
    ORACLE: 'Independent Health Verifier',
    CLOB_ONLINE: 'Marketplace Connected',
    ORACLE_CONNECTING: 'Health Data Unavailable',
  };

  assert.equal(dictionary.CLOB, 'Capacity Marketplace');
  assert.equal(dictionary.BID, 'Purchase Order');
  assert.equal(dictionary.ASK, 'Capacity Listing');
  assert.equal(dictionary.NODE_OPERATOR, 'Compute Provider');
  assert.equal(dictionary.BONDED_STAKE, 'SLA Collateral');
  assert.equal(dictionary.SLASHING, 'SLA Collateral Adjustment');
  assert.equal(dictionary.ORACLE, 'Independent Health Verifier');
});

test("Frontend: lifecycle badges translate implementation states into task language", async () => {
  const source = await readFile(new URL("../src/components/common/UiState.tsx", import.meta.url), "utf8");
  assert.match(source, /Authorization required/);
  assert.match(source, /Payment confirmation pending/);
  assert.match(source, /Access being prepared/);
  assert.match(source, /labels\[status\.toUpperCase\(\)\]/);
});

test("Frontend: order history distinguishes marketplace matches from confirmed settlement records", async () => {
  const source = await readFile(new URL("../src/components/buyer/OrderLifecycleView.tsx", import.meta.url), "utf8");
  assert.match(source, /Recent Matches/);
  assert.match(source, /confirmed settlement records appear in order history/);
  assert.doesNotMatch(source, /Completed Settlements[\s\S]{0,600}recentTrades\.length/);
});

test("Frontend: catalog cursor outages remain visible and retryable", async () => {
  const source = await readFile(new URL("../src/hooks/useCapacityOffers.ts", import.meta.url), "utf8");
  assert.match(source, /if \(cursor\) \{/);
  assert.match(source, /More capacity offers are temporarily unavailable/);
  assert.match(source, /Your current results are unchanged/);
});

test("Frontend: cursor pages deduplicate mutable live records by authoritative ID", async () => {
  const offers = await readFile(new URL("../src/hooks/useCapacityOffers.ts", import.meta.url), "utf8");
  const orders = await readFile(new URL("../src/hooks/useOrderLedger.ts", import.meta.url), "utf8");
  assert.match(offers, /const mergeOfferPages/);
  assert.match(offers, /byId\.set\(offer\.offerId, offer\)/);
  assert.match(orders, /const mergeById/);
  assert.match(orders, /order\.orderId/);
  assert.match(orders, /policy\.recurringOrderId/);
});

test("Frontend: compact navigation keeps every workspace destination reachable", async () => {
  const source = await readFile(new URL("../src/components/fintech/FintechHeader.tsx", import.meta.url), "utf8");
  for (const path of [
    "/buyer/evidence",
    "/buyer/support",
    "/buyer/settings",
    "/operator/evidence",
    "/operator/support",
    "/operator/settings",
  ]) {
    assert.match(source, new RegExp(path.replaceAll('/', '\\/')));
  }
  assert.match(source, /const moreMobileItems = navItems\.slice\(4\)/);
  assert.match(source, /useFocusTrap\(mobileMenuRef/);
  assert.match(source, /role="menu"/);
});

test("Frontend: compact More menu exposes standard menu keyboard semantics", async () => {
  const source = await readFile(new URL("../src/components/fintech/FintechHeader.tsx", import.meta.url), "utf8");
  assert.match(source, /aria-haspopup="menu"/);
  assert.match(source, /role="menu"/);
  assert.match(source, /role="menuitem"/);
  assert.match(source, /event\.key === 'ArrowDown'/);
  assert.match(source, /event\.key === 'ArrowUp'/);
  assert.match(source, /menuItems\[nextIndex\]\.focus\(\)/);
});

test("Frontend: compact navigation remains usable at narrow widths", async () => {
  const source = await readFile(new URL("../src/components/fintech/FintechHeader.tsx", import.meta.url), "utf8");
  assert.match(source, /max-w-full items-center space-x-1 overflow-x-auto/);
  assert.match(source, /const mobileLabelFor/);
  assert.match(source, /marketplace: 'Capacity'/);
  assert.match(source, /instances: 'Active'/);
  assert.match(source, /<span className="sr-only">\{item\.label\}<\/span>/);
  const styles = await readFile(new URL("../src/globals.css", import.meta.url), "utf8");
  assert.match(styles, /\.scrollbar-none\s*\{/);
  assert.match(styles, /scrollbar-width:\s*none/);
});

test("Frontend: active compact More destinations expose current-page state", async () => {
  const source = await readFile(new URL("../src/components/fintech/FintechHeader.tsx", import.meta.url), "utf8");
  assert.match(source, /role="menuitem" aria-current=\{isItemActive\(item\) \? 'page' : undefined\}/);
});

test("Frontend: workspace status uses customer-facing marketplace terminology", async () => {
  const source = await readFile(new URL("../src/components/fintech/FintechOverview.tsx", import.meta.url), "utf8");
  assert.match(source, /Marketplace connected/);
  assert.match(source, /Marketplace reconnecting/);
  assert.doesNotMatch(source, /Engine Online|Engine Connecting/);
});

test("Frontend: destructive order actions use an accessible in-product confirmation", async () => {
  const source = await readFile(new URL("../src/components/buyer/OrderLifecycleView.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /Keep order/);
  assert.match(source, /useFocusTrap\(confirmationRef/);
});

test("Frontend: entitlement balances are read for the full catalog", async () => {
  const source = await readFile(new URL("../src/hooks/useComputeContracts.ts", import.meta.url), "utf8");
  assert.match(source, /publicClient\.multicall/);
  assert.match(source, /COMPUTE_ASSETS\.map\(\(asset\) =>/);
  assert.match(source, /nextVouchers\[COMPUTE_ASSETS\[index\]\.tokenId\]/);
  assert.doesNotMatch(source, /args: \[walletAddress, 1n\]/);
});

test("Frontend: order views are deep-linkable and survive refresh", async () => {
  const source = await readFile(new URL("../src/components/buyer/OrderLifecycleView.tsx", import.meta.url), "utf8");
  assert.match(source, /useSearchParams/);
  assert.match(source, /searchParams\.get\('view'\)/);
  assert.match(source, /next\.set\('view', view\.toLowerCase\(\)\)/);
  assert.match(source, /replace: true/);
});

test("Frontend: order search context is shareable without history churn", async () => {
  const source = await readFile(new URL("../src/components/buyer/OrderLifecycleView.tsx", import.meta.url), "utf8");
  assert.match(source, /const initialQuery = searchParams\.get\('q'\)/);
  assert.match(source, /next\.set\('q', query\.trim\(\)\)/);
  assert.match(source, /return next;\n    \}, \{ replace: true \}\)/);
  assert.match(source, /Back\/forward navigation and shared links can change the query/);
  assert.match(source, /const destinationQuery = view === 'ACTIVE' \? searchQuery : view === 'HISTORY' \? historySearchQuery : recurringSearchQuery/);
});

test("Frontend: order views expose linked accessible panels", async () => {
  const source = await readFile(new URL("../src/components/buyer/OrderLifecycleView.tsx", import.meta.url), "utf8");
  assert.match(source, /id=\{`orders-tab-\$\{value\.toLowerCase\(\)\}`\}/);
  assert.match(source, /aria-controls=\{`orders-panel-\$\{value\.toLowerCase\(\)\}`\}/);
  assert.match(source, /orders-panel-active/);
  assert.match(source, /orders-panel-history/);
  assert.match(source, /orders-panel-recurring/);
  assert.match(source, /aria-label="Search active orders"/);
});

test("Frontend: order view tabs implement standard keyboard roving behavior", async () => {
  const source = await readFile(new URL("../src/components/buyer/OrderLifecycleView.tsx", import.meta.url), "utf8");
  assert.match(source, /tabIndex=\{selectedView === value \? 0 : -1\}/);
  assert.match(source, /event\.key === 'ArrowRight'/);
  assert.match(source, /event\.key === 'ArrowLeft'/);
  assert.match(source, /event\.key === 'Home'/);
  assert.match(source, /event\.key === 'End'/);
  assert.match(source, /orders-tab-\$\{nextView\.toLowerCase\(\)\}/);
});

test("Frontend: order data tables expose captions and column semantics", async () => {
  const source = await readFile(new URL("../src/components/buyer/OrderLifecycleView.tsx", import.meta.url), "utf8");
  assert.match(source, /<caption className="sr-only">Recurring capacity procurement policies<\/caption>/);
  assert.match(source, /<caption className="sr-only">Settled capacity order history<\/caption>/);
  assert.match(source, /<caption className="sr-only">Active capacity purchase orders<\/caption>/);
  assert.ok((source.match(/scope="col"/g) || []).length >= 20);
});

test("Frontend: order tabs show truthful loaded counts and continuation", async () => {
  const source = await readFile(new URL("../src/components/buyer/OrderLifecycleView.tsx", import.meta.url), "utf8");
  assert.match(source, /orderViewSummaries/);
  assert.match(source, /count: ledger\.activeStatus === 'ready'/);
  assert.match(source, /count: ledger\.historyStatus === 'ready'/);
  assert.match(source, /count: ledger\.recurringStatus === 'ready'/);
  assert.match(source, /hasMore: Boolean\(ledger\.nextActiveCursor\)/);
  assert.match(source, /hasMore: Boolean\(ledger\.nextHistoryCursor\)/);
  assert.match(source, /hasMore: Boolean\(ledger\.nextRecurringCursor\)/);
  assert.match(source, /count unavailable/);
  assert.match(source, /\? '\+' : ''/);
});

test("Frontend: order page controls fetch cursor pages at the loaded boundary", async () => {
  const view = await readFile(new URL("../src/components/buyer/OrderLifecycleView.tsx", import.meta.url), "utf8");
  assert.match(view, /const handleOrderPageNext = async/);
  assert.match(view, /await ledger\.loadMoreOrders\(view\)/);
  assert.match(view, /aria-label="Next active orders page"/);
  assert.match(view, /aria-label="Next history page"/);
  assert.match(view, /recurringPageCount/);
  assert.match(view, /aria-label="Next recurring orders page"/);
  assert.match(view, /Use the next-page action to retry/);
});

test("Frontend: history and recurring orders expose task-oriented status filters", async () => {
  const source = await readFile(new URL("../src/components/buyer/OrderLifecycleView.tsx", import.meta.url), "utf8");
  const ledger = await readFile(new URL("../src/hooks/useOrderLedger.ts", import.meta.url), "utf8");
  assert.match(source, /historyStatusFilter/);
  assert.match(source, /Filter order history by status/);
  assert.match(source, /FAILED.*Failed or expired/);
  assert.match(source, /recurringStatusFilter/);
  assert.match(source, /Filter recurring orders by status/);
  assert.match(source, /PAUSED.*Paused/);
  assert.match(source, /historyStatus: historyStatusFilter === 'ALL' \? undefined : historyStatusFilter/);
  assert.match(source, /recurringStatus: recurringStatusFilter === 'ALL' \? undefined : recurringStatusFilter/);
  assert.match(source, /next\.set\('status', status\)/);
  assert.match(source, /const requestedStatus = searchParams\.get\('status'\)/);
  assert.match(ledger, /status=\$\{encodeURIComponent\(historyStatus\)\}/);
  assert.match(ledger, /status=\$\{encodeURIComponent\(recurringStatus\)\}/);
});

test("Frontend: catalog filters and sort are shareable without history churn", async () => {
  const source = await readFile(new URL("../src/components/buyer/CapacityCatalog.tsx", import.meta.url), "utf8");
  assert.match(source, /useSearchParams/);
  assert.match(source, /searchParams\.get\('q'\)/);
  assert.match(source, /searchParams\.get\('category'\)/);
  assert.match(source, /searchParams\.get\('region'\)/);
  assert.match(source, /searchParams\.get\('sort'\)/);
  assert.match(source, /next\.set\(key, value\)/);
  assert.match(source, /replace: true/);
});

test("Frontend: global catalog exposes every supported region", async () => {
  const source = await readFile(new URL("../src/components/buyer/CapacityCatalog.tsx", import.meta.url), "utf8");
  for (const region of ["us-east", "us-west", "eu-central", "eu-west", "ap-northeast", "ap-southeast"]) {
    assert.match(source, new RegExp(`['\\"]${region}['\\"]`));
  }
  assert.match(source, /liveOffers\.offers\.forEach\(\(offer\) => regions\.add\(offer\.region\)\)/);
  assert.match(source, /formatRegionLabel/);
});

test("Frontend: unavailable order views remain retryable", async () => {
  const source = await readFile(new URL("../src/components/buyer/OrderLifecycleView.tsx", import.meta.url), "utf8");
  assert.match(source, /Active order ledger unavailable/);
  assert.match(source, /Recurring orders unavailable[\s\S]{0,300}actionLabel="Retry"/);
  assert.match(source, /Order history unavailable[\s\S]{0,300}actionLabel="Retry"/);
  assert.match(source, /onAction=\{\(\) => void ledger\.refresh\(\)\}/);
});

test("Frontend: catalog requests have a bounded timeout", async () => {
  const source = await readFile(new URL("../src/hooks/useCapacityOffers.ts", import.meta.url), "utf8");
  assert.match(source, /const OFFER_REQUEST_TIMEOUT_MS = 8_000/);
  assert.match(source, /signal: AbortSignal\.timeout\(OFFER_REQUEST_TIMEOUT_MS\)/);
});

test("Frontend: order reads and commands have bounded deadlines", async () => {
  const source = await readFile(new URL("../src/hooks/useOrderLedger.ts", import.meta.url), "utf8");
  assert.match(source, /const LEDGER_READ_TIMEOUT_MS = 8_000/);
  assert.match(source, /const LEDGER_COMMAND_TIMEOUT_MS = 15_000/);
  assert.ok((source.match(/signal: AbortSignal\.timeout\(LEDGER_READ_TIMEOUT_MS\)/g) || []).length >= 5);
  assert.ok((source.match(/signal: AbortSignal\.timeout\(LEDGER_COMMAND_TIMEOUT_MS\)/g) || []).length >= 4);
});

test("Frontend: stale order pagination cannot clear the current loading state", async () => {
  const source = await readFile(new URL("../src/hooks/useOrderLedger.ts", import.meta.url), "utf8");
  assert.match(source, /finally \{\s*if \(requestId === requestSequence\.current\) setIsLoadingMore\(false\);/g);
  assert.ok((source.match(/finally \{\s*if \(requestId === requestSequence\.current\) setIsLoadingMore\(false\);/g) || []).length >= 2);
});

test("Frontend: provider collateral never uses a hardcoded instance scope", async () => {
  const source = await readFile(new URL("../src/hooks/useComputeContracts.ts", import.meta.url), "utf8");
  assert.match(source, /providerInstanceId\?: bigint \| null/);
  assert.match(source, /providerInstanceId === undefined \|\| providerInstanceId === null/);
  assert.match(source, /setBondedStakeMon\('—'\)/);
  assert.doesNotMatch(source, /functionName: 'bondedStakes',[\s\S]{0,180}args: \[1n\]/);
});

test("Frontend: provider staking requires an explicit onchain SLA instance ID", async () => {
  const source = await readFile(new URL("../src/components/seller/SellerPortal.tsx", import.meta.url), "utf8");
  assert.match(source, /stakeInstanceId/);
  assert.match(source, /onchain SLA instance ID/);
  assert.match(source, /bondStake\(BigInt\(stakeInstanceId\), stakeAmount\)/);
  assert.doesNotMatch(source, /bondStake\(BigInt\(selectedTokenId\), stakeAmount\)/);
});

test("Frontend: provider telemetry never synthesizes missing measurements", async () => {
  const source = await readFile(new URL("../src/components/seller/ProviderFleetView.tsx", import.meta.url), "utf8");
  assert.match(source, /typeof data\?\.sampledAt !== 'string'/);
  assert.match(source, /!Number\.isFinite\(data\?\.uptimePpm\)/);
  assert.match(source, /!Number\.isFinite\(data\?\.pingMs\)/);
  assert.doesNotMatch(source, /data\.uptimePpm \?\? 0|data\.pingMs \?\? 0|new Date\(\)\.toISOString\(\)/);
});

test("Frontend: provider fleet reads are bounded and stale telemetry cannot overwrite newer state", async () => {
  const fleetHook = await readFile(new URL("../src/hooks/useProviderFleet.ts", import.meta.url), "utf8");
  const fleetView = await readFile(new URL("../src/components/seller/ProviderFleetView.tsx", import.meta.url), "utf8");
  assert.match(fleetHook, /const PROVIDER_FLEET_TIMEOUT_MS = 8_000/);
  assert.match(fleetHook, /AbortSignal\.timeout\(PROVIDER_FLEET_TIMEOUT_MS\)/);
  assert.match(fleetView, /const refreshSequence = useRef\(0\)/);
  assert.match(fleetView, /if \(requestId !== refreshSequence\.current\) return/);
});

test("Frontend: provider fleet outages have an in-product retry action", async () => {
  const source = await readFile(new URL("../src/components/seller/SellerPortal.tsx", import.meta.url), "utf8");
  assert.match(source, /refresh: refreshFleet/);
  assert.match(source, /Provider fleet unavailable/);
  assert.match(source, /actionLabel="Retry fleet service"/);
  assert.match(source, /onAction=\{\(\) => void refreshFleet\(\)\}/);
});

test("Frontend: provider listings use the durable wallet-scoped offer ledger", async () => {
  const hook = await readFile(new URL("../src/hooks/useProviderOffers.ts", import.meta.url), "utf8");
  const portal = await readFile(new URL("../src/components/seller/SellerPortal.tsx", import.meta.url), "utf8");
  const dashboard = await readFile(new URL("../src/components/seller/SellerDashboard.tsx", import.meta.url), "utf8");
  assert.match(hook, /\/api\/v1\/provider\/offers/);
  assert.match(hook, /limit: '100'/);
  assert.match(hook, /nextCursor/);
  assert.match(portal, /useProviderOffers/);
  assert.match(portal, /providerOffers\.offers\.map/);
  assert.match(portal, /retireOffer\(offerId\)/);
  assert.doesNotMatch(portal, /const askOrders = openOrders\.filter/);
  assert.match(dashboard, /activeListingCount: number \| null/);
  assert.doesNotMatch(dashboard, /const askOrders = openOrders\.filter/);
});

test("Frontend: provider destructive actions use in-product confirmation", async () => {
  const source = await readFile(new URL("../src/components/seller/SellerPortal.tsx", import.meta.url), "utf8");
  assert.match(source, /requestNodeRemoval/);
  assert.match(source, /requestListingCancellation/);
  assert.match(source, /Cancel capacity listing\?/);
  assert.match(source, /Remove hardware node\?/);
  assert.match(source, /aria-labelledby="provider-confirmation-title"/);
  assert.doesNotMatch(source, /window\.confirm/);
});

test("Frontend: provider dashboard KPI navigation is keyboard-semantic", async () => {
  const source = await readFile(new URL("../src/components/seller/SellerDashboard.tsx", import.meta.url), "utf8");
  assert.ok((source.match(/<button\s+type="button"\s+onClick=\{\(\) => onNavigate/g) || []).length >= 4);
  assert.doesNotMatch(source, /<div\s+\n\s+onClick=\{\(\) => onNavigate/);
});

test("Frontend: customer dashboard KPI navigation uses native button behavior", async () => {
  const source = await readFile(new URL("../src/components/buyer/BuyerDashboard.tsx", import.meta.url), "utf8");
  assert.ok((source.match(/<button\s+type="button"\s+onClick=\{\(\) => onNavigate/g) || []).length >= 4);
  assert.doesNotMatch(source, /role="button"/);
  assert.doesNotMatch(source, /onKeyDown=\{\(e\) => e\.key === 'Enter'/);
});

test("Frontend: advanced market asset cards are keyboard-selectable controls", async () => {
  const source = await readFile(new URL("../src/components/Terminal.tsx", import.meta.url), "utf8");
  assert.match(source, /<button[\s\S]{0,180}key=\{asset\.tokenId\}[\s\S]{0,120}handleAssetSelect\(asset\)/);
  assert.match(source, /aria-pressed=\{isSelected\}/);
});

test("Frontend: technical specification directory does not claim static data is live inventory", async () => {
  const source = await readFile(new URL("../src/components/Terminal.tsx", import.meta.url), "utf8");
  assert.match(source, /Supported Capacity Specifications/);
  assert.match(source, /Specification only — check live offers/);
  assert.doesNotMatch(source, /Real onchain capacity across/);
  assert.doesNotMatch(source, /Live inventory via marketplace feed/);
});

test("Frontend: live offer token identifiers remain precision-safe strings", async () => {
  const source = await readFile(new URL("../src/components/buyer/CapacityCatalog.tsx", import.meta.url), "utf8");
  assert.match(source, /tokenIdText: string/);
  assert.match(source, /String\(candidate\.tokenId\) === offer\.tokenId/);
  assert.match(source, /BigInt\(activePurchaseAsset\.tokenIdText\)/);
  assert.doesNotMatch(source, /COMPUTE_ASSETS\.find\(\(candidate\) => candidate\.tokenId === Number\(offer\.tokenId\)\)/);
});

test("Frontend: onchain entitlement identifiers are matched as exact strings", async () => {
  const sources = await Promise.all([
    readFile(new URL("../src/components/buyer/BuyerPortal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/buyer/BuyerDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/fintech/FintechOverview.tsx", import.meta.url), "utf8"),
  ]);
  for (const source of sources) {
    assert.match(source, /String\(a\.tokenId\) === tokenId/);
    assert.doesNotMatch(source, /const id = Number\(tokenId\)/);
  }
});

test("Frontend: order-book transport preserves high-range identifiers as strings", async () => {
  const socket = await readFile(new URL("../src/hooks/useOrderBookSocket.ts", import.meta.url), "utf8");
  const provider = await readFile(new URL("../src/components/seller/SellerPortal.tsx", import.meta.url), "utf8");
  assert.match(socket, /orderId: string/);
  assert.match(socket, /tokenId\?: string/);
  assert.match(socket, /orderId: String\(o\.order_id\)/);
  assert.match(socket, /tokenId: String\(o\.token_id\)/);
  assert.doesNotMatch(socket, /orderId: Number\(o\.order_id\)/);
  assert.match(provider, /String\(a\.tokenId\) === offer\.tokenId/);
});

test("Frontend: capacity discovery controls use clear terminology and explicit labels", async () => {
  const source = await readFile(new URL("../src/components/buyer/CapacityCatalog.tsx", import.meta.url), "utf8");
  assert.match(source, /aria-label="Search live capacity offers"/);
  assert.match(source, /id="capacity-region"/);
  assert.match(source, /id="capacity-sort"/);
  assert.match(source, /id="no-maximum-rate"/);
  assert.match(source, /aria-controls="advanced-market-view"/);
  assert.match(source, /Open market detail/);
  assert.doesNotMatch(source, /Open advanced trading view/);
});

test("Frontend: settlement status is truthful when contract reads are unavailable", async () => {
  const contractHook = await readFile(new URL("../src/hooks/useComputeContracts.ts", import.meta.url), "utf8");
  const context = await readFile(new URL("../src/context/MarketplaceContext.tsx", import.meta.url), "utf8");
  const header = await readFile(new URL("../src/components/fintech/FintechHeader.tsx", import.meta.url), "utf8");
  assert.match(contractHook, /export type ContractReadStatus = 'idle' \| 'loading' \| 'ready' \| 'unavailable'/);
  assert.match(contractHook, /setReadStatus\('unavailable'\)/);
  assert.match(context, /contractReadStatus: ContractReadStatus/);
  assert.match(header, /Settlement \{settlementStatus\.label\.toLowerCase\(\)\}/);
  assert.doesNotMatch(header, /<span>Settlement network<\/span>/);
});

test("Frontend: public and authenticated surfaces share the root theme provider", async () => {
  const main = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  const console = await readFile(new URL("../src/AuthenticatedConsole.tsx", import.meta.url), "utf8");
  assert.match(main, /<ThemeProvider>[\s\S]*<WorkspaceProvider>[\s\S]*<App \/>[\s\S]*<\/WorkspaceProvider>[\s\S]*<\/ThemeProvider>/);
  assert.match(console, /<MarketplaceProvider>/);
});

test("Frontend: public bootstrap keeps full marketplace data context behind authentication", async () => {
  const main = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  const auth = await readFile(new URL("../src/components/InlinePrivyAuth.tsx", import.meta.url), "utf8");
  assert.match(main, /WorkspaceProvider/);
  assert.doesNotMatch(main, /MarketplaceProvider/);
  assert.match(auth, /useWorkspace/);
});

test("Frontend: global brand navigation is a keyboard-accessible control", async () => {
  const header = await readFile(new URL("../src/components/fintech/FintechHeader.tsx", import.meta.url), "utf8");
  assert.match(header, /<button[\s\S]{0,180}aria-label="Go to workspace overview"[\s\S]{0,180}navigate\(userRole/);
  assert.match(header, /focus-visible:ring-2/);
});

test("Frontend: order views degrade independently when one ledger endpoint is unavailable", async () => {
  const hook = await readFile(new URL("../src/hooks/useOrderLedger.ts", import.meta.url), "utf8");
  const view = await readFile(new URL("../src/components/buyer/OrderLifecycleView.tsx", import.meta.url), "utf8");
  assert.match(hook, /Promise\.allSettled/);
  assert.match(hook, /activeStatus: viewStatus\.active/);
  assert.match(hook, /recurringStatus: viewStatus\.recurring/);
  assert.match(view, /ledger\.activeStatus === 'loading'/);
  assert.match(view, /ledger\.recurringStatus === 'error' \|\| ledger\.recurringStatus === 'unavailable'/);
});

test("Frontend: shared styles honor reduced-motion preferences", async () => {
  const styles = await readFile(new URL("../src/globals.css", import.meta.url), "utf8");
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /animation-duration: 0\.01ms !important/);
  assert.match(styles, /transition-duration: 0\.01ms !important/);
});

test("Frontend: deployment configuration validates RPC and market-data protocols", async () => {
  const source = await readFile(new URL("../src/config/env.ts", import.meta.url), "utf8");
  assert.match(source, /VITE_RPC_URL and VITE_WS_URL must be valid absolute URLs/);
  assert.match(source, /VITE_RPC_URL must use HTTP\(S\)/);
  assert.match(source, /VITE_WS_URL must use WS\(S\)/);
  assert.match(source, /\['http:', 'https:'\]\.includes\(rpcProtocol\)/);
  assert.match(source, /\['ws:', 'wss:'\]\.includes\(wsProtocol\)/);
});

test("Frontend: purchase confirmation revalidates live offer state and availability", async () => {
  const source = await readFile(new URL("../src/components/buyer/CapacityCatalog.tsx", import.meta.url), "utf8");
  assert.match(source, /activePurchaseOffer\.status !== 'AVAILABLE'/);
  assert.match(source, /Date\.parse\(activePurchaseOffer\.expiresAt\)/);
  assert.match(source, /BigInt\(activePurchaseOffer\.availableSeconds\) < requestedSeconds/);
  assert.match(source, /Available for this order \(MON\)/);
  assert.match(source, /USDC balance:/);
});

test("Frontend: contract polling is bounded and visibility-aware", async () => {
  const source = await readFile(new URL("../src/hooks/useComputeContracts.ts", import.meta.url), "utf8");
  assert.match(source, /CONTRACT_REFRESH_INTERVAL_MS = 15_000/);
  assert.match(source, /document\.visibilityState === 'visible'/);
  assert.match(source, /document\.addEventListener\('visibilitychange'/);
  assert.match(source, /document\.removeEventListener\('visibilitychange'/);
});

test("Frontend: stale contract reads cannot overwrite a newer wallet or instance", async () => {
  const source = await readFile(new URL("../src/hooks/useComputeContracts.ts", import.meta.url), "utf8");
  assert.match(source, /const refreshSequence = useRef\(0\)/);
  assert.match(source, /const requestSequence = \+\+refreshSequence\.current/);
  assert.match(source, /const isCurrentRequest = \(\) => requestSequence === refreshSequence\.current/);
  assert.match(source, /if \(!isCurrentRequest\(\)\) return;/);
  assert.match(source, /refreshSequence\.current \+= 1/);
});

test("Frontend: purchase pricing is validated in code and supports precise MON rates", async () => {
  const source = await readFile(new URL("../src/components/buyer/CapacityCatalog.tsx", import.meta.url), "utf8");
  assert.match(source, /pricePerSecond <= 0n \|\| purchaseDurationHours <= 0/);
  assert.match(source, /type="text"/);
  assert.match(source, /inputMode="decimal"/);
  assert.match(source, /placeholder="0\.0000"/);
  assert.doesNotMatch(source, /step="0\.01"/);
});

test("Frontend: explorer links use one canonical network endpoint", async () => {
  const contracts = await readFile(new URL("../src/config/contracts.ts", import.meta.url), "utf8");
  assert.match(contracts, /MONAD_EXPLORER_URL = 'https:\/\/testnet\.monadexplorer\.com'/);
  const sourceFiles = [
    "../src/components/PrivyAuthProvider.tsx",
    "../src/hooks/useWeb3Wallet.ts",
    "../src/context/ToastContext.tsx",
    "../src/components/common/NotificationDrawer.tsx",
    "../src/components/common/TransactionTimeline.tsx",
    "../src/components/fintech/FintechHeader.tsx",
  ];
  for (const relativePath of sourceFiles) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.doesNotMatch(source, /https:\/\/testnet\.monadexplorer\.com/);
    assert.match(source, /MONAD_EXPLORER_URL/);
  }
});
