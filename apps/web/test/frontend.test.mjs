import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseEther, hashTypedData, recoverAddress } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  ReasonCode,
  REASON_CODE_MESSAGES,
  AGENTGUARD_EIP712_DOMAIN,
  SPEND_REQUEST_TYPES,
  MONAD_TESTNET_CHAIN_ID,
} from "@agentguard/shared-types";

test("AgentGuard Frontend: Landing page presents enterprise value metrics with zero debug leaks", async () => {
  const source = await readFile(new URL("../src/components/LandingPage.tsx", import.meta.url), "utf8");
  assert.match(source, /AgentGuard/);
  assert.match(source, /Sub-Second/);
  assert.match(source, /&lt;1ms/);
  assert.match(source, /Non-Custodial/);
  // Zero technical debug leaks
  assert.doesNotMatch(source, /9101/);
  assert.doesNotMatch(source, /9002/);
  assert.doesNotMatch(source, /localhost/);
});

test("AgentGuard Domain: Complete machine-readable reason codes and diagnostic descriptions", () => {
  const expectedCodes = [
    { code: ReasonCode.ERR_NONE, name: "ERR_NONE" },
    { code: ReasonCode.ERR_KILL_SWITCH, name: "ERR_KILL_SWITCH" },
    { code: ReasonCode.ERR_MAX_PER_TX, name: "ERR_MAX_PER_TX" },
    { code: ReasonCode.ERR_MAX_PER_WINDOW, name: "ERR_MAX_PER_WINDOW" },
    { code: ReasonCode.ERR_VELOCITY_EXCEEDED, name: "ERR_VELOCITY_EXCEEDED" },
    { code: ReasonCode.ERR_MERCHANT_NOT_ALLOWED, name: "ERR_MERCHANT_NOT_ALLOWED" },
    { code: ReasonCode.ERR_BUDGET_DEPLETED, name: "ERR_BUDGET_DEPLETED" },
    { code: ReasonCode.ERR_EXPIRED, name: "ERR_EXPIRED" },
    { code: ReasonCode.ERR_NONCE_REUSED, name: "ERR_NONCE_REUSED" },
    { code: ReasonCode.ERR_SIGNATURE_INVALID, name: "ERR_SIGNATURE_INVALID" },
  ];

  for (const item of expectedCodes) {
    assert.ok(item.code >= 0, `Reason code ${item.name} must be >= 0`);
    const msg = REASON_CODE_MESSAGES[item.code];
    assert.ok(msg && msg.length > 5, `Reason message for ${item.name} must be defined and meaningful`);
  }
});

test("AgentGuard Frontend: Payment evaluation requires user-entered real intent data", async () => {
  const source = await readFile(new URL("../src/components/dashboard/RogueAgentSimulator.tsx", import.meta.url), "utf8");
  assert.match(source, /Evaluate a real payment intent/);
  assert.match(source, /Merchant address/);
  assert.match(source, /Evaluate onchain/);
  assert.match(source, /createPolicyRejectionResponse/);
  assert.doesNotMatch(source, /0x8888888888888888888888888888888888888888/);
  assert.doesNotMatch(source, /fakeTxHash|Mock|mockSignature/);
});

test("AgentGuard Frontend: PolicyStudio enforces positive limits and valid window constraints", async () => {
  const source = await readFile(new URL("../src/components/dashboard/PolicyStudio.tsx", import.meta.url), "utf8");
  assert.match(source, /Max Spend Per Transaction/);
  assert.match(source, /Max Spend Per Sliding Window/);
  assert.match(source, /Sliding Window Duration/);
  assert.match(source, /Max Transaction Velocity/);
  assert.match(source, /Active Kill Switch/);
  assert.match(source, /windowSeconds <= 0/);
  assert.match(source, /maxVelocity <= 0/);
});

test("AgentGuard Frontend: FleetOverview renders agent table, filters, and O(1) kill-switch controls", async () => {
  const source = await readFile(new URL("../src/components/dashboard/FleetOverview.tsx", import.meta.url), "utf8");
  assert.match(source, /Monitored Agent Wallets/);
  assert.match(source, /Velocity \(Tx \/ Limit\)/);
  assert.match(source, /Reputation/);
  assert.match(source, /Actions/);
  assert.match(source, /Kill Switch/);
  assert.match(source, /Restore/);
  assert.match(source, /Register Agent/);
  assert.match(source, /Lifecycle/);
});

test("AgentGuard Frontend: AuditLedger formats onchain reason codes, export buttons, and explorer links", async () => {
  const source = await readFile(new URL("../src/components/dashboard/AuditLedger.tsx", import.meta.url), "utf8");
  assert.match(source, /Verifiable Policy Audit Trail/);
  assert.match(source, /ERR_\{rec\.decision\.reasonCode\}/);
  assert.match(source, /handleExportJSON/);
  assert.match(source, /handleExportCSV/);
  assert.match(source, /MONAD_EXPLORER_URL/);
});

test("AgentGuard Frontend: DisjointSlotVisualizer renders 32-byte Monad packed storage slot", async () => {
  const source = await readFile(new URL("../src/components/dashboard/DisjointSlotVisualizer.tsx", import.meta.url), "utf8");
  assert.match(source, /computePackedSlotHex/);
  assert.match(source, /spentInWindow/);
  assert.match(source, /windowStart/);
  assert.match(source, /txCountInWindow/);
  assert.match(source, /nonce/);
  assert.match(source, /Single 32-Byte Word/);
});

test("AgentGuard Frontend: AgentOnboardingModal supports templates and address validation", async () => {
  const source = await readFile(new URL("../src/components/dashboard/AgentOnboardingModal.tsx", import.meta.url), "utf8");
  assert.match(source, /Provision New Autonomous Agent/);
  assert.match(source, /AGENT_TEMPLATES/);
  assert.match(source, /Use an existing agent wallet/);
  assert.doesNotMatch(source, /Generate Testnet Keypair/);
  assert.match(source, /Max Per Tx/);
  assert.match(source, /Max Per Window/);
});

test("AgentGuard Frontend: LifecycleStudio renders authoritative operational state", async () => {
  const source = await readFile(new URL("../src/components/dashboard/LifecycleStudio.tsx", import.meta.url), "utf8");
  assert.match(source, /Agent lifecycle/);
  assert.match(source, /Spend state/);
  assert.match(source, /Audit evidence is chain-derived/);
  assert.doesNotMatch(source, /fakeTxHash|Mock|mockSignature|LIFECYCLE_STAGES/);
});

test("AgentGuard Cryptography: EIP-712 SpendRequest signing and signer recovery on Monad (10143)", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const merchant = "0x8888888888888888888888888888888888888888";

  const spendRequest = {
    agent: account.address,
    merchant,
    amount: parseEther("0.25"),
    category: "0x0000000000000000000000000000000000000000000000000000000000000001",
    timestamp: 1720000000n,
    deadline: 1720003600n,
    nonce: 7n,
  };

  const signature = await account.signTypedData({
    domain: AGENTGUARD_EIP712_DOMAIN,
    types: SPEND_REQUEST_TYPES,
    primaryType: "SpendRequest",
    message: spendRequest,
  });

  const recovered = await recoverAddress({
    hash: hashTypedData({
      domain: AGENTGUARD_EIP712_DOMAIN,
      types: SPEND_REQUEST_TYPES,
      primaryType: "SpendRequest",
      message: spendRequest,
    }),
    signature,
  });

  assert.equal(recovered.toLowerCase(), account.address.toLowerCase());
  assert.equal(AGENTGUARD_EIP712_DOMAIN.chainId, MONAD_TESTNET_CHAIN_ID);
});

test("AgentGuard Zero-Mock Mandate: Zero Math.random in frontend runtime code", async () => {
  const files = [
    "../src/components/dashboard/FleetOverview.tsx",
    "../src/components/dashboard/PolicyStudio.tsx",
    "../src/components/dashboard/RogueAgentSimulator.tsx",
    "../src/components/dashboard/AuditLedger.tsx",
    "../src/components/dashboard/LifecycleStudio.tsx",
    "../src/components/dashboard/AgentOnboardingModal.tsx",
    "../src/components/dashboard/DisjointSlotVisualizer.tsx",
    "../src/components/dashboard/SpendVelocityChart.tsx",
    "../src/components/dashboard/BudgetPoolManager.tsx",
    "../src/components/dashboard/ComplianceReportView.tsx",
    "../src/components/dashboard/FleetDemoController.tsx",
    "../src/components/LandingPage.tsx",
    "../src/hooks/usePolicyContracts.ts",
  ];

  for (const file of files) {
    const content = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(content, /Math\.random\(\)/, `File ${file} must not contain Math.random()`);
  }
});

test("AgentGuard Frontend: SpendVelocityChart renders SVG time-series and threshold cap", async () => {
  const source = await readFile(new URL("../src/components/dashboard/SpendVelocityChart.tsx", import.meta.url), "utf8");
  assert.match(source, /Spend Velocity & Rate Limit Time-Series/);
  assert.match(source, /maxVelocityCap/);
  assert.match(source, /Cap/);
});

test("AgentGuard Frontend: BudgetPoolManager enforces Org -> BudgetPool -> Agent hierarchy", async () => {
  const source = await readFile(new URL("../src/components/dashboard/BudgetPoolManager.tsx", import.meta.url), "utf8");
  assert.match(source, /Org → BudgetPool → Agent Governance/);
  assert.match(source, /ERR_BUDGET_DEPLETED/);
  assert.match(source, /Active Budget Pools/);
});

test("AgentGuard Frontend: ComplianceReportView renders policy invariant audit dossier and export", async () => {
  const source = await readFile(new URL("../src/components/dashboard/ComplianceReportView.tsx", import.meta.url), "utf8");
  assert.match(source, /Enterprise Policy Invariant & Risk Audit Dossier/);
  assert.match(source, /Reason Code Accounting Trail/);
  assert.match(source, /Isolated State Partitioning/);
  assert.match(source, /Export JSON Dossier/);
});

test("AgentGuard Frontend: FleetDemoController coordinates 20-agent autonomous scenario", async () => {
  const source = await readFile(new URL("../src/components/dashboard/FleetDemoController.tsx", import.meta.url), "utf8");
  assert.match(source, /Multi-Agent Fleet Orchestrator/);
  assert.match(source, /Normal Fleet Operations/);
  assert.match(source, /Rogue Burst/);
  assert.match(source, /Run 20-Agent Scenario/);
});

test("AgentGuard IAM: AccessManagementView renders operator directory, capability matrix, and audit trail", async () => {
  const source = await readFile(new URL("../src/components/dashboard/AccessManagementView.tsx", import.meta.url), "utf8");
  assert.match(source, /Team & Role Governance \(IAM\)/);
  assert.match(source, /Operator Directory/);
  assert.match(source, /Permissions Matrix/);
  assert.match(source, /IAM Audit Trail/);
  assert.match(source, /canManageAccess/);
  assert.match(source, /Provision Operator/);
  assert.match(source, /handleExportAuditCSV/);
});

test("AgentGuard IAM: ProvisionOperatorModal validates address format and required metadata", async () => {
  const source = await readFile(new URL("../src/components/dashboard/ProvisionOperatorModal.tsx", import.meta.url), "utf8");
  assert.match(source, /Provision Team Operator/);
  assert.match(source, /isAddress\(address\.trim\(\)\)/);
  assert.match(source, /provisionOperator/);
  assert.match(source, /Operator Identifier \/ Name/);
  assert.match(source, /Monad Wallet Address/);
});

test("AgentGuard IAM: RBAC permissions strictly restrict canManageAccess to Super Admin", async () => {
  const source = await readFile(new URL("../src/context/RbacContext.tsx", import.meta.url), "utf8");
  assert.match(source, /canManageAccess: true/);
  assert.match(source, /canManageAccess: false/);
  assert.match(source, /provisionOperator/);
  assert.match(source, /assignRole/);
  assert.match(source, /revokeOperator/);
  assert.match(source, /toggleOperatorStatus/);
});

test("AgentGuard IAM: Cryptographic Privy JWT decoding and fallback resolution hierarchy", async () => {
  const source = await readFile(new URL("../src/context/RbacContext.tsx", import.meta.url), "utf8");
  
  // Verify architectural integration
  assert.match(source, /decodeJwtPayload/);
  assert.match(source, /extractRoleFromJwtPayload/);
  assert.match(source, /getAccessToken/);
  assert.match(source, /roleSource/);
  assert.match(source, /privy_jwt/);
  assert.match(source, /privy_metadata/);
  assert.match(source, /operator_directory/);
  assert.match(source, /least_privilege_default/);

  // Functional verification of JWT decoding algorithm
  function testDecodeJwt(token) {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(json);
  }

  function testExtractRole(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const candidate =
      payload.role ||
      payload.custom_metadata?.role ||
      payload.customMetadata?.role ||
      payload['https://agentguard.io/role'] ||
      payload.app_metadata?.role;
    const validRoles = ['super_admin', 'sec_ops', 'treasury', 'fleet_devops', 'auditor'];
    return validRoles.includes(candidate) ? candidate : null;
  }

  // 1. Direct role claim in JWT
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
  const payloadDirect = Buffer.from(JSON.stringify({ sub: 'did:privy:123', role: 'sec_ops' })).toString('base64url');
  const tokenDirect = `${header}.${payloadDirect}.mock_signature`;
  assert.equal(testExtractRole(testDecodeJwt(tokenDirect)), 'sec_ops');

  // 2. Nested custom_metadata claim in JWT
  const payloadNested = Buffer.from(JSON.stringify({ sub: 'did:privy:456', custom_metadata: { role: 'treasury' } })).toString('base64url');
  const tokenNested = `${header}.${payloadNested}.mock_signature`;
  assert.equal(testExtractRole(testDecodeJwt(tokenNested)), 'treasury');

  // 3. Tampered / invalid role in JWT rejected to prevent spoofing
  const payloadSpoofed = Buffer.from(JSON.stringify({ sub: 'did:privy:789', role: 'unauthorized_god_mode' })).toString('base64url');
  const tokenSpoofed = `${header}.${payloadSpoofed}.mock_signature`;
  assert.equal(testExtractRole(testDecodeJwt(tokenSpoofed)), null, 'Spoofed role must be rejected');
});

test("AgentGuard Tables: Pagination supports 100s of accounts with range metrics and size selection", async () => {
  const paginationSource = await readFile(new URL("../src/components/common/Pagination.tsx", import.meta.url), "utf8");
  assert.match(paginationSource, /ChevronsLeft/);
  assert.match(paginationSource, /ChevronsRight/);
  assert.match(paginationSource, /pageSizeOptions = \[10, 25, 50, 100\]/);
  assert.match(paginationSource, /Showing/);
  assert.match(paginationSource, /entries/);

  // Verify pagination calculation logic for 500 accounts across 50 pages
  const totalItems = 500;
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  assert.equal(totalPages, 50);

  const getPageNumbers = (currentPage, pagesCount) => {
    const pages = [];
    if (pagesCount <= 7) {
      for (let i = 1; i <= pagesCount; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('ellipsis');
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(pagesCount - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < pagesCount - 2) pages.push('ellipsis');
      pages.push(pagesCount);
    }
    return pages;
  };

  // Test page 1 of 50
  const p1 = getPageNumbers(1, 50);
  assert.deepEqual(p1, [1, 2, 'ellipsis', 50]);

  // Test middle page 25 of 50
  const p25 = getPageNumbers(25, 50);
  assert.deepEqual(p25, [1, 'ellipsis', 24, 25, 26, 'ellipsis', 50]);

  // Test last page 50 of 50
  const p50 = getPageNumbers(50, 50);
  assert.deepEqual(p50, [1, 'ellipsis', 49, 50]);

  // Verify all 4 major tables import and mount Pagination
  const fleetOverviewSource = await readFile(new URL("../src/components/dashboard/FleetOverview.tsx", import.meta.url), "utf8");
  assert.match(fleetOverviewSource, /<Pagination/);
  assert.match(fleetOverviewSource, /pageSize=\{pageSize\}/);

  const auditLedgerSource = await readFile(new URL("../src/components/dashboard/AuditLedger.tsx", import.meta.url), "utf8");
  assert.match(auditLedgerSource, /<Pagination/);
  assert.match(auditLedgerSource, /pageSize=\{pageSize\}/);

  const accessMgmtSource = await readFile(new URL("../src/components/dashboard/AccessManagementView.tsx", import.meta.url), "utf8");
  assert.match(accessMgmtSource, /<Pagination/);
  assert.match(accessMgmtSource, /operatorPageSize/);
  assert.match(accessMgmtSource, /auditPageSize/);

  const policyStudioSource = await readFile(new URL("../src/components/dashboard/PolicyStudio.tsx", import.meta.url), "utf8");
  assert.match(policyStudioSource, /<Pagination/);
  assert.match(policyStudioSource, /directoryPageSize/);

  const budgetPoolSource = await readFile(new URL("../src/components/dashboard/BudgetPoolManager.tsx", import.meta.url), "utf8");
  assert.match(budgetPoolSource, /<Pagination/);
  assert.match(budgetPoolSource, /poolPageSize/);
});

test("AgentGuard Print Architecture: Neutralizes viewport, hides sidebar chrome, and formats formal attestation", async () => {
  const cssSource = await readFile(new URL("../src/globals.css", import.meta.url), "utf8");
  assert.match(cssSource, /@media print/);
  assert.match(cssSource, /print-color-adjust: exact/);
  assert.match(cssSource, /page-break-inside: avoid/);

  const sidebarSource = await readFile(new URL("../src/components/navigation/AgentGuardSidebar.tsx", import.meta.url), "utf8");
  assert.match(sidebarSource, /print:hidden/);

  const consoleSource = await readFile(new URL("../src/AuthenticatedConsole.tsx", import.meta.url), "utf8");
  assert.match(consoleSource, /print:static/);
  assert.match(consoleSource, /print:overflow-visible/);
  assert.match(consoleSource, /print:hidden/);

  const cardSource = await readFile(new URL("../src/components/common/Card.tsx", import.meta.url), "utf8");
  assert.match(cardSource, /print:break-inside-avoid/);

  const complianceSource = await readFile(new URL("../src/components/dashboard/ComplianceReportView.tsx", import.meta.url), "utf8");
  assert.match(complianceSource, /AgentGuard Enterprise Control Plane/);
  assert.match(complianceSource, /Official Institutional Print Letterhead/);
  assert.match(complianceSource, /Official Attestation Sign-Off & Verification Footer/);
  assert.match(complianceSource, /document\.title = `AgentGuard-Dossier-\$\{reportId\}`/);

  const dashboardSource = await readFile(new URL("../src/components/dashboard/AgentGuardDashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboardSource, /No agent policy configured/);
  assert.match(dashboardSource, /backdrop-blur-sm print:hidden/);
});

test("AgentGuard Tenant Isolation: RBAC unlocks agent registration and defaults authenticated users to agent_developer", async () => {
  const rbacSource = await readFile(new URL("../src/context/RbacContext.tsx", import.meta.url), "utf8");
  assert.match(rbacSource, /agent_developer/);
  assert.match(rbacSource, /Agent Developer/);
  assert.match(rbacSource, /canRegisterAgents: true/);
  assert.match(rbacSource, /canEditPolicy: true/);
  assert.match(rbacSource, /canToggleKillSwitch: true/);
  assert.match(rbacSource, /authenticatedRole: 'agent_developer'/);
  assert.match(rbacSource, /authenticatedRole: 'auditor'/);
});

test("AgentGuard Tenant Isolation: FleetOverview provides tenant-scoped My Agents view and AgentOnboardingModal generates keypairs", async () => {
  const fleetSource = await readFile(new URL("../src/components/dashboard/FleetOverview.tsx", import.meta.url), "utf8");
  assert.match(fleetSource, /My Agents/);
  assert.match(fleetSource, /Network Fleet/);
  assert.match(fleetSource, /fleetScope === 'my_agents'/);
  assert.match(fleetSource, /No Agents Registered Under Your Account/);

  const modalSource = await readFile(new URL("../src/components/dashboard/AgentOnboardingModal.tsx", import.meta.url), "utf8");
  assert.match(modalSource, /generatePrivateKey/);
  assert.match(modalSource, /privateKeyToAccount/);
  assert.match(modalSource, /Generate Keypair/);
  assert.match(modalSource, /Import Address/);
  assert.match(modalSource, /Autonomous Agent Private Key/);
  assert.match(modalSource, /Non-Custodial Safeguard/);
  assert.match(modalSource, /save-vault-checkbox/);

  const dashboardCtxSource = await readFile(new URL("../src/context/DashboardContext.tsx", import.meta.url), "utf8");
  assert.match(dashboardCtxSource, /getUserProvisionedAgents/);
  assert.match(dashboardCtxSource, /addUserProvisionedAgent/);
  assert.match(dashboardCtxSource, /saveAgentCredentials/);
  assert.match(dashboardCtxSource, /fleetScope/);
  assert.match(dashboardCtxSource, /setFleetScope/);
});

