import React, { useState, useMemo, useEffect } from 'react';
import { type Address } from 'viem';
import {
  Users,
  Shield,
  UserPlus,
  Key,
  Lock,
  Search,
  Check,
  Copy,
  ExternalLink,
  MoreVertical,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserX,
  FileSpreadsheet,
  Download,
  RefreshCw,
  Terminal,
  Code2,
  Plus,
  Trash2,
  Cpu,
  Zap,
} from 'lucide-react';
import { Card } from '../common/Card';
import { Button } from '../common/Button';
import { Pagination } from '../common/Pagination';
import { PageHeader } from '../common/PageHeader';
import { useRbac, OPERATOR_ROLES, type OperatorRole } from '../../context/RbacContext';
import { useDashboard } from '../../context/DashboardContext';
import { useToast } from '../../context/ToastContext';
import { type OperatorUser, type OperatorStatus } from '../../types/access';
import { ProvisionOperatorModal } from './ProvisionOperatorModal';
import { MONAD_EXPLORER_URL } from '../../config/contracts';

export interface MachineServiceAccount {
  id: string;
  name: string;
  apiKey: string;
  agentAddress: Address;
  agentName: string;
  role: OperatorRole;
  createdAt: string;
  lastUsedAt: string;
  status: 'ACTIVE' | 'REVOKED';
}

const MACHINE_ACCOUNTS_STORAGE_KEY = 'agentguard_machine_service_accounts';

const getDefaultMachineAccounts = (defaultAgentAddr?: Address, defaultAgentName?: string): MachineServiceAccount[] => {
  const fallbackAddr = (defaultAgentAddr || '0x71C8364771542f7F74e64F843818e3848Ea8bB29') as Address;
  const fallbackName = defaultAgentName || 'Qwen 3.8 Max Financial Sentinel';
  return [
    {
      id: 'sa-001',
      name: 'LangChain Production Ingestion Worker',
      apiKey: 'ag_live_sec_7a2f8190c1e8d9a4b3c2e1f0',
      agentAddress: fallbackAddr,
      agentName: fallbackName,
      role: 'agent_developer',
      createdAt: '2026-09-10T14:30:00.000Z',
      lastUsedAt: new Date(Date.now() - 1000 * 95).toISOString(),
      status: 'ACTIVE',
    },
    {
      id: 'sa-002',
      name: 'Qwen 3.8 Max Real-Time Inference Daemon',
      apiKey: 'ag_live_sec_b94d1283e74cf5a6d7c8b9a0',
      agentAddress: fallbackAddr,
      agentName: fallbackName,
      role: 'fleet_devops',
      createdAt: '2026-09-12T09:15:00.000Z',
      lastUsedAt: new Date(Date.now() - 1000 * 25).toISOString(),
      status: 'ACTIVE',
    },
  ];
};

const generateSecureApiKey = (): string => {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return 'ag_live_sec_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
};

export const AccessManagementView: React.FC = () => {
  const {
    roleConfig,
    authenticatedRole,
    roleSource,
    can,
    operators,
    roleAuditLog,
    assignRole,
    toggleOperatorStatus,
    revokeOperator,
    syncRoleToPrivy,
  } = useRbac();

  const { agents } = useDashboard();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'directory' | 'matrix' | 'audit' | 'service_accounts'>('directory');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [isProvisionModalOpen, setIsProvisionModalOpen] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [editingOperator, setEditingOperator] = useState<Address | null>(null);
  const [syncingDid, setSyncingDid] = useState<string | null>(null);

  // Pagination States
  const [operatorPage, setOperatorPage] = useState(1);
  const [operatorPageSize, setOperatorPageSize] = useState(10);
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(10);

  // Machine Service Accounts State
  const [serviceAccounts, setServiceAccounts] = useState<MachineServiceAccount[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(MACHINE_ACCOUNTS_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // ignore
    }
    return getDefaultMachineAccounts(agents[0]?.address, agents[0]?.name);
  });

  const [selectedSnippetAccountId, setSelectedSnippetAccountId] = useState<string>(
    serviceAccounts[0]?.id || 'sa-001'
  );
  const [snippetLang, setSnippetLang] = useState<'python' | 'typescript' | 'curl' | 'langchain'>('python');
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  // Modal / Form state for provisioning machine service account
  const [isCreateAccountOpen, setIsCreateAccountOpen] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountAgentAddr, setNewAccountAgentAddr] = useState<string>('');
  const [newAccountRole, setNewAccountRole] = useState<OperatorRole>('agent_developer');

  useEffect(() => {
    try {
      localStorage.setItem(MACHINE_ACCOUNTS_STORAGE_KEY, JSON.stringify(serviceAccounts));
    } catch (e) {
      console.error('Failed to persist service accounts', e);
    }
  }, [serviceAccounts]);

  const activeSnippetAccount = useMemo(() => {
    return serviceAccounts.find((sa) => sa.id === selectedSnippetAccountId) || serviceAccounts[0];
  }, [serviceAccounts, selectedSnippetAccountId]);

  const handleCreateServiceAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccountName.trim()) {
      toast.addToast({
        type: 'error',
        title: 'Validation Error',
        message: 'Please provide a descriptive name for the machine service account.',
      });
      return;
    }

    const boundAgent = agents.find((a) => a.address.toLowerCase() === (newAccountAgentAddr || agents[0]?.address || '').toLowerCase());
    const boundAgentAddress = (boundAgent?.address || agents[0]?.address || '0x71C8364771542f7F74e64F843818e3848Ea8bB29') as Address;
    const boundAgentName = boundAgent?.name || 'Autonomous Agent';

    const newAccount: MachineServiceAccount = {
      id: `sa-${Date.now().toString(36)}`,
      name: newAccountName.trim(),
      apiKey: generateSecureApiKey(),
      agentAddress: boundAgentAddress,
      agentName: boundAgentName,
      role: newAccountRole,
      createdAt: new Date().toISOString(),
      lastUsedAt: 'Never',
      status: 'ACTIVE',
    };

    setServiceAccounts((prev) => [newAccount, ...prev]);
    setSelectedSnippetAccountId(newAccount.id);
    setIsCreateAccountOpen(false);
    setNewAccountName('');
    toast.addToast({
      type: 'success',
      title: 'Machine Account Created',
      message: `Issued secret key ${newAccount.apiKey.slice(0, 15)}... for ${newAccount.name}.`,
    });
  };

  const handleToggleAccountStatus = (id: string) => {
    setServiceAccounts((prev) =>
      prev.map((sa) => {
        if (sa.id === id) {
          const nextStatus = sa.status === 'ACTIVE' ? 'REVOKED' : 'ACTIVE';
          toast.addToast({
            type: nextStatus === 'ACTIVE' ? 'success' : 'warning',
            title: `Service Account ${nextStatus}`,
            message: `Key for ${sa.name} is now ${nextStatus.toLowerCase()}.`,
          });
          return { ...sa, status: nextStatus };
        }
        return sa;
      })
    );
  };

  const handleDeleteAccount = (id: string) => {
    setServiceAccounts((prev) => prev.filter((sa) => sa.id !== id));
    toast.addToast({
      type: 'info',
      title: 'Machine Key Deleted',
      message: 'Service account credentials were permanently purged from the vault.',
    });
  };

  const handleCopyKey = (key: string, id: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKeyId(id);
    setTimeout(() => setCopiedKeyId(null), 2000);
    toast.addToast({
      type: 'info',
      title: 'Machine API Key Copied',
      message: 'Key copied to clipboard. Keep credentials strictly confidential.',
    });
  };

  const getSdkSnippet = (lang: 'python' | 'typescript' | 'curl' | 'langchain') => {
    const key = activeSnippetAccount?.apiKey || 'ag_live_sec_demo12345';
    const agent = activeSnippetAccount?.agentAddress || '0x71C8364771542f7F74e64F843818e3848Ea8bB29';

    if (lang === 'python') {
      return `# Python: Drop-in OpenAI SDK Reverse Proxy
# Gateway enforces Monad Parallel EVM spend policies and circuit breakers automatically.
from openai import OpenAI

client = OpenAI(
    base_url="https://gateway.agentguard.io/v1",
    api_key="${key}",
    default_headers={
        "X-AgentGuard-Agent": "${agent}",
    }
)

response = client.chat.completions.create(
    model="qwen-3.8-max",
    messages=[{"role": "user", "content": "Execute onchain batch settlement"}],
)
print(response.choices[0].message.content)`;
    }

    if (lang === 'typescript') {
      return `// TypeScript / Node.js: Drop-in OpenAI SDK Reverse Proxy
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'https://gateway.agentguard.io/v1',
  apiKey: '${key}',
  defaultHeaders: {
    'X-AgentGuard-Agent': '${agent}',
  },
});

const completion = await openai.chat.completions.create({
  model: 'qwen-3.8-max',
  messages: [{ role: 'user', content: 'Execute onchain batch settlement' }],
});
console.log(completion.choices[0].message.content);`;
    }

    if (lang === 'curl') {
      return `# cURL: Raw HTTP x402 reverse proxy request
curl https://gateway.agentguard.io/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${key}" \\
  -H "X-AgentGuard-Agent: ${agent}" \\
  -d '{
    "model": "qwen-3.8-max",
    "messages": [{"role": "user", "content": "Execute onchain batch settlement"}]
  }'`;
    }

    return `# LangChain / CrewAI: AgentGuard Monad Gated LLM
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="qwen-3.8-max",
    base_url="https://gateway.agentguard.io/v1",
    api_key="${key}",
    model_kwargs={
        "extra_headers": {
            "X-AgentGuard-Agent": "${agent}",
        }
    }
)`;
  };

  const handleCopySnippet = () => {
    navigator.clipboard.writeText(getSdkSnippet(snippetLang));
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
    toast.addToast({
      type: 'info',
      title: 'Snippet Copied',
      message: `${snippetLang.toUpperCase()} drop-in proxy configuration copied to clipboard.`,
    });
  };

  useEffect(() => {
    setOperatorPage(1);
  }, [searchQuery, roleFilter, statusFilter]);

  const handleSyncPrivy = async (did: string, role: OperatorRole) => {
    setSyncingDid(did);
    try {
      const res = await syncRoleToPrivy(did, role);
      toast.addToast({
        type: 'success',
        title: 'Privy Role Synchronized',
        message: res.message,
      });
    } catch (err: unknown) {
      toast.addToast({
        type: 'error',
        title: 'Privy Sync Failed',
        message: err instanceof Error ? err.message : 'Failed to update Privy custom metadata.',
      });
    } finally {
      setSyncingDid(null);
    }
  };

  const canManage = can('canManageAccess');

  const roleSourceBadge =
    roleSource === 'privy_jwt'
      ? { text: 'Cryptographic Privy JWT', color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' }
      : roleSource === 'privy_metadata'
      ? { text: 'Privy User Metadata', color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30' }
      : roleSource === 'operator_directory'
      ? { text: 'Enterprise Directory', color: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30' }
      : roleSource === 'root_authority'
      ? { text: 'Cryptographic Root Deployer', color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30' }
      : { text: 'Least-Privilege Auditor (Default)', color: 'bg-card-muted text-fg-muted border-card-border' };

  // Filtered Operators
  const filteredOperators = useMemo(() => {
    return operators.filter((op) => {
      const matchesSearch =
        op.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        op.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (op.email && op.email.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesRole = roleFilter === 'ALL' || op.role === roleFilter;
      const matchesStatus = statusFilter === 'ALL' || op.status === statusFilter;

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [operators, searchQuery, roleFilter, statusFilter]);

  const paginatedOperators = useMemo(() => {
    const start = (operatorPage - 1) * operatorPageSize;
    return filteredOperators.slice(start, start + operatorPageSize);
  }, [filteredOperators, operatorPage, operatorPageSize]);

  const paginatedAuditLog = useMemo(() => {
    const start = (auditPage - 1) * auditPageSize;
    return roleAuditLog.slice(start, start + auditPageSize);
  }, [roleAuditLog, auditPage, auditPageSize]);

  // Telemetry Counts
  const totalOperators = operators.length;
  const activeCount = operators.filter((o) => o.status === 'ACTIVE').length;
  const adminSecOpsCount = operators.filter((o) => o.role === 'super_admin' || o.role === 'sec_ops').length;
  const treasuryDevOpsCount = operators.filter((o) => o.role === 'treasury' || o.role === 'fleet_devops').length;
  const auditorCount = operators.filter((o) => o.role === 'auditor').length;

  const handleCopy = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopiedAddress(addr);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const handleExportAuditCSV = () => {
    const headers = ['Timestamp', 'ActorAddress', 'TargetAddress', 'TargetName', 'Action', 'PreviousRole', 'NewRole', 'Notes'];
    const rows = roleAuditLog.map((log) => [
      log.timestamp,
      log.actorAddress,
      log.targetAddress,
      `"${log.targetName.replace(/"/g, '""')}"`,
      log.action,
      log.previousRole || 'NONE',
      log.newRole || 'NONE',
      `"${(log.notes || '').replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `agentguard_iam_audit_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!canManage) {
    return (
      <div className="py-12 px-4 max-w-2xl mx-auto font-sans">
        <Card padding="lg" className="text-center border-card-border bg-card shadow-lg">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-danger/10 text-danger border border-danger/20 mb-4">
            <Lock className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-fg">Access Restricted</h2>
          <p className="mt-2 text-xs text-fg-muted leading-relaxed max-w-md mx-auto">
            Team &amp; Role Governance (IAM) is strictly restricted to verified Root Super Administrators. Your active role is <span className="font-mono font-bold text-fg">{roleConfig.label}</span>.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Button variant="primary" size="sm" onClick={() => window.location.assign('/fleet')}>
              Return to Fleet Command
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 font-sans">
      {/* Canonical Page Header */}
      <PageHeader
        title="Team & Role Governance (IAM)"
        description="Manage authorized enterprise operators, delegate RBAC privileges, inspect capability matrices, and audit authorization changes."
        breadcrumbs={[{ label: 'AgentGuard', href: '/' }, { label: 'Team & Role Governance' }]}
        badge={
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-mono font-medium ${roleSourceBadge.color}`}>
            <Shield className="h-3 w-3" />
            Source: {roleSourceBadge.text}
          </span>
        }
        actions={
          canManage ? (
            <Button
              variant="primary"
              size="sm"
              leftIcon={<UserPlus className="h-4 w-4" />}
              onClick={() => setIsProvisionModalOpen(true)}
            >
              Provision Operator
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled
              leftIcon={<Lock className="h-3.5 w-3.5 text-fg-subtle" />}
              title="Super Admin authority required to provision team members"
            >
              Provision Operator (Admin Only)
            </Button>
          )
        }
      />

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card padding="md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-fg-muted">Active Operators</span>
            <Users className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-2 text-xl font-bold font-mono text-fg">{activeCount} / {totalOperators}</p>
          <p className="mt-0.5 text-[11px] text-fg-subtle">Authorized on Monad</p>
        </Card>

        <Card padding="md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-fg-muted">Root & SecOps</span>
            <ShieldAlert className="h-4 w-4 text-rose-400" />
          </div>
          <p className="mt-2 text-xl font-bold font-mono text-fg">{adminSecOpsCount}</p>
          <p className="mt-0.5 text-[11px] text-fg-subtle">Emergency Stop Authority</p>
        </Card>

        <Card padding="md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-fg-muted">Treasury & DevOps</span>
            <Key className="h-4 w-4 text-amber-400" />
          </div>
          <p className="mt-2 text-xl font-bold font-mono text-fg">{treasuryDevOpsCount}</p>
          <p className="mt-0.5 text-[11px] text-fg-subtle">Pool & Agent Managers</p>
        </Card>

        <Card padding="md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-fg-muted">Compliance Auditors</span>
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 text-xl font-bold font-mono text-fg">{auditorCount}</p>
          <p className="mt-0.5 text-[11px] text-fg-subtle">Read-Only Attestation</p>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-card-border pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('directory')}
          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
            activeTab === 'directory'
              ? 'bg-primary text-white shadow-xs'
              : 'text-fg-muted hover:bg-card-muted hover:text-fg'
          }`}
        >
          Operator Directory ({operators.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('matrix')}
          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
            activeTab === 'matrix'
              ? 'bg-primary text-white shadow-xs'
              : 'text-fg-muted hover:bg-card-muted hover:text-fg'
          }`}
        >
          Permissions Matrix
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
            activeTab === 'audit'
              ? 'bg-primary text-white shadow-xs'
              : 'text-fg-muted hover:bg-card-muted hover:text-fg'
          }`}
        >
          IAM Audit Trail ({roleAuditLog.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('service_accounts')}
          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'service_accounts'
              ? 'bg-primary text-white shadow-xs'
              : 'text-fg-muted hover:bg-card-muted hover:text-fg'
          }`}
        >
          <Key className="h-3.5 w-3.5" />
          Service Accounts &amp; Machine Keys ({serviceAccounts.length})
        </button>
      </div>

      {/* TAB 1: Operator Directory */}
      {activeTab === 'directory' && (
        <Card padding="none">
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-b border-card-border">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search operator or address..."
                className="w-full rounded-lg bg-card-muted border border-card-border pl-8 pr-3 py-1.5 text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-primary transition"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="rounded-lg bg-card-muted border border-card-border px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-primary"
              >
                <option value="ALL">All Roles</option>
                {Object.values(OPERATOR_ROLES).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg bg-card-muted border border-card-border px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-primary"
              >
                <option value="ALL">All Status</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="INVITED">Invited</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-fg">
              <thead className="border-b border-card-border bg-card-muted/30 text-[11px] font-bold text-fg-muted uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Operator</th>
                  <th className="px-4 py-3">Wallet Address</th>
                  <th className="px-4 py-3">Assigned Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Assigned Date</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {filteredOperators.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-fg-subtle">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Users className="h-8 w-8 text-fg-subtle" />
                        <p className="text-sm font-semibold text-fg">No operators found</p>
                        <p className="text-xs text-fg-muted">
                          {searchQuery || roleFilter !== 'ALL' || statusFilter !== 'ALL'
                            ? 'Try clearing search filters to see all team members.'
                            : 'Provision an operator to delegate access on Monad.'}
                        </p>
                        {canManage && (
                          <Button
                            variant="primary"
                            size="sm"
                            className="mt-2"
                            onClick={() => setIsProvisionModalOpen(true)}
                          >
                            Provision Operator
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedOperators.map((op) => {
                    const roleDef = OPERATOR_ROLES[op.role] || OPERATOR_ROLES.auditor;
                    const isEditing = editingOperator?.toLowerCase() === op.address.toLowerCase();

                    return (
                      <tr key={op.address} className="hover:bg-card-muted/30 transition">
                        {/* Operator Name */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-subtle text-primary font-bold text-xs">
                              {op.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-bold text-fg">{op.name}</div>
                              {op.email && <div className="text-[11px] text-fg-subtle">{op.email}</div>}
                              {op.privyDid && (
                                <div className="text-[10px] font-mono text-primary/80 flex items-center gap-1 mt-0.5">
                                  <span>DID: {op.privyDid.slice(0, 16)}...</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Address */}
                        <td className="px-4 py-3.5 font-mono text-[11px]">
                          <div className="flex items-center gap-1.5">
                            <span>{op.address.slice(0, 8)}...{op.address.slice(-6)}</span>
                            <button
                              type="button"
                              onClick={() => handleCopy(op.address)}
                              className="text-fg-subtle hover:text-fg transition p-0.5 cursor-pointer"
                              title="Copy full address"
                            >
                              {copiedAddress === op.address ? (
                                <Check className="h-3 w-3 text-emerald-500" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </button>
                            <a
                              href={`${MONAD_EXPLORER_URL}/address/${op.address}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-fg-subtle hover:text-primary transition p-0.5"
                              title="View on Monad Explorer"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </td>

                        {/* Assigned Role */}
                        <td className="px-4 py-3.5">
                          {isEditing ? (
                            <select
                              value={op.role}
                              onChange={(e) => {
                                assignRole(op.address, e.target.value as OperatorRole);
                                setEditingOperator(null);
                              }}
                              className="rounded-lg bg-card border border-primary px-2 py-1 text-xs text-fg focus:outline-none"
                            >
                              {Object.values(OPERATOR_ROLES).map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className={`inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded-full border ${roleDef.color}`}>
                              <span>{roleDef.icon}</span>
                              <span>{roleDef.badge}</span>
                            </span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              op.status === 'ACTIVE'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20'
                                : 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20'
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${op.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                            {op.status}
                          </span>
                        </td>

                        {/* Date */}
                        <td className="px-4 py-3.5 text-[11px] text-fg-muted">
                          {new Date(op.assignedAt).toLocaleDateString()}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5 text-right">
                          {canManage ? (
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              {op.privyDid && (
                                <button
                                  type="button"
                                  disabled={syncingDid === op.privyDid}
                                  onClick={() => handleSyncPrivy(op.privyDid!, op.role)}
                                  className="rounded px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary-subtle transition cursor-pointer flex items-center gap-1 disabled:opacity-50"
                                  title="Synchronize role directly to Privy custom metadata via Gateway API"
                                >
                                  <RefreshCw className={`h-3 w-3 ${syncingDid === op.privyDid ? 'animate-spin' : ''}`} />
                                  <span>Sync to Privy</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setEditingOperator(isEditing ? null : op.address)}
                                className="rounded px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary-subtle transition cursor-pointer"
                              >
                                {isEditing ? 'Cancel' : 'Change Role'}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  toggleOperatorStatus(
                                    op.address,
                                    op.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
                                  )
                                }
                                className={`rounded px-2 py-1 text-[11px] font-semibold transition cursor-pointer ${
                                  op.status === 'ACTIVE'
                                    ? 'text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10'
                                    : 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10'
                                }`}
                              >
                                {op.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                              </button>
                              <button
                                type="button"
                                onClick={() => revokeOperator(op.address)}
                                className="rounded px-2 py-1 text-[11px] font-semibold text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition cursor-pointer"
                              >
                                Revoke
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-fg-subtle italic">Read-Only</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Operator Directory Pagination */}
          <Pagination
            currentPage={operatorPage}
            pageSize={operatorPageSize}
            totalItems={filteredOperators.length}
            onPageChange={setOperatorPage}
            onPageSizeChange={(size) => {
              setOperatorPageSize(size);
              setOperatorPage(1);
            }}
          />
        </Card>
      )}

      {/* TAB 2: Permissions Matrix */}
      {activeTab === 'matrix' && (
        <Card padding="none">
          <div className="p-4 border-b border-card-border bg-card-muted/30">
            <h2 className="text-sm font-bold text-fg">Institutional Capability & Privilege Matrix</h2>
            <p className="text-xs text-fg-muted mt-0.5">
              Granular mapping of operational controls enforced across Monad smart contracts and control plane workflows.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-card-border bg-card-muted/20 text-[11px] font-bold text-fg-muted uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Capability / Operation</th>
                  {Object.values(OPERATOR_ROLES).map((r) => (
                    <th key={r.id} className="px-4 py-3 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-base">{r.icon}</span>
                        <span>{r.label}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border font-sans">
                <tr>
                  <td className="px-4 py-3 font-semibold text-fg">
                    Emergency Freeze / Instant Halt
                    <div className="text-[10px] text-fg-muted font-normal">Immediate stop of rogue or compromised agent wallets</div>
                  </td>
                  {Object.values(OPERATOR_ROLES).map((r) => (
                    <td key={r.id} className="px-4 py-3 text-center">
                      {r.permissions.canToggleKillSwitch ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 font-bold">✓</span>
                      ) : (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/10 text-rose-400">✗</span>
                      )}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="px-4 py-3 font-semibold text-fg">
                    Policy Authoring & Limit Editing
                    <div className="text-[10px] text-fg-muted font-normal">Transaction spend caps, rolling windows, and velocity rules</div>
                  </td>
                  {Object.values(OPERATOR_ROLES).map((r) => (
                    <td key={r.id} className="px-4 py-3 text-center">
                      {r.permissions.canEditPolicy ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 font-bold">✓</span>
                      ) : (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/10 text-rose-400">✗</span>
                      )}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="px-4 py-3 font-semibold text-fg">
                    Budget Pool Allocation & Top-ups
                    <div className="text-[10px] text-fg-muted font-normal">Org-level shared treasury limits and agent assignments</div>
                  </td>
                  {Object.values(OPERATOR_ROLES).map((r) => (
                    <td key={r.id} className="px-4 py-3 text-center">
                      {r.permissions.canManageBudgetPools ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 font-bold">✓</span>
                      ) : (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/10 text-rose-400">✗</span>
                      )}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="px-4 py-3 font-semibold text-fg">
                    Agent Registration & Key Onboarding
                    <div className="text-[10px] text-fg-muted font-normal">Provisioning cryptographic keys and agent metadata</div>
                  </td>
                  {Object.values(OPERATOR_ROLES).map((r) => (
                    <td key={r.id} className="px-4 py-3 text-center">
                      {r.permissions.canRegisterAgents ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 font-bold">✓</span>
                      ) : (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/10 text-rose-400">✗</span>
                      )}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="px-4 py-3 font-semibold text-fg">
                    Adversarial Risk Simulations
                    <div className="text-[10px] text-fg-muted font-normal">Simulate rogue spend spikes, window overflows, and merchant blocks</div>
                  </td>
                  {Object.values(OPERATOR_ROLES).map((r) => (
                    <td key={r.id} className="px-4 py-3 text-center">
                      {r.permissions.canRunSimulations ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 font-bold">✓</span>
                      ) : (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/10 text-rose-400">✗</span>
                      )}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="px-4 py-3 font-semibold text-fg">
                    Cryptographic Audit Attestation Export
                    <div className="text-[10px] text-fg-muted font-normal">Download signed JSON/CSV reason code evidence for regulators</div>
                  </td>
                  {Object.values(OPERATOR_ROLES).map((r) => (
                    <td key={r.id} className="px-4 py-3 text-center">
                      {r.permissions.canExportAudit ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 font-bold">✓</span>
                      ) : (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/10 text-rose-400">✗</span>
                      )}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="px-4 py-3 font-semibold text-fg">
                    IAM & Operator Role Provisioning
                    <div className="text-[10px] text-fg-muted font-normal">Assign, reassign, suspend, and revoke team access permissions</div>
                  </td>
                  {Object.values(OPERATOR_ROLES).map((r) => (
                    <td key={r.id} className="px-4 py-3 text-center">
                      {r.permissions.canManageAccess ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 font-bold">✓</span>
                      ) : (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/10 text-rose-400">✗</span>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* TAB 3: IAM Audit Trail */}
      {activeTab === 'audit' && (
        <Card padding="none">
          <div className="flex items-center justify-between p-4 border-b border-card-border bg-card-muted/30">
            <div>
              <h2 className="text-sm font-bold text-fg">Verifiable IAM Authorization Log</h2>
              <p className="text-xs text-fg-muted mt-0.5">
                Tamper-evident record of all operator role assignments, status changes, and delegations.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Download className="h-3.5 w-3.5 text-primary" />}
              onClick={handleExportAuditCSV}
            >
              Export CSV
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-fg">
              <thead className="border-b border-card-border bg-card-muted/20 text-[11px] font-bold text-fg-muted uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Target Operator</th>
                  <th className="px-4 py-3">Role Transition</th>
                  <th className="px-4 py-3">Authorized By</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {roleAuditLog.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-fg-subtle">
                      No IAM access modifications logged yet. Operations will record here automatically.
                    </td>
                  </tr>
                ) : (
                  paginatedAuditLog.map((ev) => (
                    <tr key={ev.id} className="hover:bg-card-muted/30 transition">
                      <td className="px-4 py-3 font-mono text-[11px] text-fg-muted">
                        {new Date(ev.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex text-[10px] font-bold font-mono px-2 py-0.5 rounded ${
                            ev.action === 'ASSIGN'
                              ? 'bg-primary-subtle text-primary border border-primary/20'
                              : ev.action === 'REASSIGN'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : ev.action === 'SUSPEND' || ev.action === 'REVOKE'
                              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          }`}
                        >
                          {ev.action}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-fg">{ev.targetName}</div>
                        <div className="font-mono text-[10px] text-fg-subtle">
                          {ev.targetAddress.slice(0, 6)}...{ev.targetAddress.slice(-4)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[11px]">
                        {ev.previousRole && (
                          <span className="text-fg-subtle line-through mr-1.5">
                            {OPERATOR_ROLES[ev.previousRole]?.label || ev.previousRole}
                          </span>
                        )}
                        {ev.newRole ? (
                          <span className="font-bold text-fg">
                            {OPERATOR_ROLES[ev.newRole]?.label || ev.newRole}
                          </span>
                        ) : (
                          <span className="text-rose-400 font-semibold">None (Revoked)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-fg-muted">
                        {ev.actorAddress.slice(0, 6)}...{ev.actorAddress.slice(-4)}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-fg-subtle">
                        {ev.notes || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* IAM Audit Trail Pagination */}
          <Pagination
            currentPage={auditPage}
            pageSize={auditPageSize}
            totalItems={roleAuditLog.length}
            onPageChange={setAuditPage}
            onPageSizeChange={(size) => {
              setAuditPageSize(size);
              setAuditPage(1);
            }}
          />
        </Card>
      )}

      {/* TAB 4: Service Accounts & Machine Keys */}
      {activeTab === 'service_accounts' && (
        <div className="space-y-4">
          {/* Header Card */}
          <Card padding="md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Terminal className="h-5 w-5 text-primary" />
                  <h3 className="text-sm font-bold text-fg">Machine Service Accounts &amp; Reverse Proxy SDK</h3>
                </div>
                <p className="mt-1 text-xs text-fg-muted max-w-2xl">
                  Deploy autonomous headless agents with scoped machine credentials (<code className="font-mono text-primary font-semibold">ag_live_sec_...</code>) and route AI inference through the AgentGuard x402 gateway. Every request undergoes sub-millisecond Monad Parallel EVM policy evaluation and triggers the Circuit Breaker upon policy breaches.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<Plus className="h-4 w-4" />}
                  onClick={() => setIsCreateAccountOpen(true)}
                >
                  Create Service Account
                </Button>
              </div>
            </div>
          </Card>

          {/* Drop-in SDK Reverse Proxy Snippet */}
          <Card padding="md" className="border-card-border bg-slate-950 text-white dark:bg-slate-950 shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Code2 className="h-4 w-4 text-primary" />
                <span className="text-xs font-bold tracking-wide text-slate-200">
                  Drop-in SDK Reverse Proxy Configuration
                </span>
                <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-mono text-primary font-bold">
                  Zero Client Refactor
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* Active Key Selector */}
                {serviceAccounts.length > 0 && (
                  <select
                    value={selectedSnippetAccountId}
                    onChange={(e) => setSelectedSnippetAccountId(e.target.value)}
                    className="rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-primary"
                  >
                    {serviceAccounts.map((sa) => (
                      <option key={sa.id} value={sa.id}>
                        {sa.name} ({sa.apiKey.slice(0, 16)}...)
                      </option>
                    ))}
                  </select>
                )}
                {/* Snippet Language Selector */}
                <div className="flex items-center bg-slate-900 rounded-md p-0.5 border border-slate-700">
                  {(['python', 'typescript', 'curl', 'langchain'] as const).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => setSnippetLang(lang)}
                      className={`px-2 py-1 text-[11px] font-mono font-semibold rounded transition cursor-pointer ${
                        snippetLang === lang
                          ? 'bg-primary text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {lang === 'python' ? 'Python' : lang === 'typescript' ? 'TypeScript' : lang === 'curl' ? 'cURL' : 'LangChain'}
                    </button>
                  ))}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={copiedSnippet ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  onClick={handleCopySnippet}
                  className="bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800 text-xs"
                >
                  {copiedSnippet ? 'Copied' : 'Copy Snippet'}
                </Button>
              </div>
            </div>

            <div className="mt-3 relative">
              <pre className="font-mono text-xs text-emerald-400 bg-slate-950 p-3 rounded-lg overflow-x-auto leading-relaxed border border-slate-900">
                <code>{getSdkSnippet(snippetLang)}</code>
              </pre>
            </div>

            <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800">
              <div className="flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                <span>Base URL: <code className="font-mono text-slate-300">https://gateway.agentguard.io/v1</code></span>
              </div>
              <div className="font-mono text-[10px] text-slate-500">
                Settlement: Monad Testnet (10143) • 400ms Finality
              </div>
            </div>
          </Card>

          {/* Machine Accounts Table */}
          <Card padding="none">
            <div className="p-4 border-b border-card-border flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-fg-muted">Active Machine Keys ({serviceAccounts.length})</h4>
                <p className="text-[11px] text-fg-subtle">Authorized headless API keys partitioned by agent address</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-card-border bg-card-muted/50 text-[11px] uppercase tracking-wider font-mono text-fg-subtle">
                    <th className="px-4 py-3">Workload / Service</th>
                    <th className="px-4 py-3">API Secret Key</th>
                    <th className="px-4 py-3">Bound Agent Identity</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Last Active</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {serviceAccounts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-fg-subtle">
                        No machine service accounts provisioned yet. Click "Create Service Account" to issue an API key.
                      </td>
                    </tr>
                  ) : (
                    serviceAccounts.map((sa) => (
                      <tr key={sa.id} className="hover:bg-card-muted/30 transition">
                        <td className="px-4 py-3">
                          <div className="font-bold text-fg flex items-center gap-1.5">
                            <Cpu className="h-3.5 w-3.5 text-primary" />
                            {sa.name}
                          </div>
                          <div className="font-mono text-[10px] text-fg-subtle">ID: {sa.id}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px]">
                          <div className="flex items-center gap-1.5">
                            <span className="text-fg-muted">
                              {sa.apiKey.slice(0, 14)}••••••••••••{sa.apiKey.slice(-4)}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyKey(sa.apiKey, sa.id)}
                              className="text-fg-subtle hover:text-fg p-1 rounded transition cursor-pointer"
                              title="Copy API Key"
                            >
                              {copiedKeyId === sa.id ? (
                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-fg">{sa.agentName}</div>
                          <div className="font-mono text-[10px] text-fg-subtle">
                            {sa.agentAddress.slice(0, 6)}...{sa.agentAddress.slice(-4)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-mono font-bold bg-primary-subtle text-primary border border-primary/20">
                            {OPERATOR_ROLES[sa.role]?.label || sa.role}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              sa.status === 'ACTIVE'
                                ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            }`}
                          >
                            {sa.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[11px] text-fg-muted font-mono">
                          {sa.lastUsedAt.includes('T') ? new Date(sa.lastUsedAt).toLocaleTimeString() : sa.lastUsedAt}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setSelectedSnippetAccountId(sa.id);
                                toast.addToast({
                                  type: 'info',
                                  title: 'Snippet Loaded',
                                  message: `Loaded ${sa.name} credentials into reverse proxy SDK snippet.`,
                                });
                              }}
                              title="Load into SDK snippet"
                            >
                              Use in SDK
                            </Button>
                            <Button
                              variant={sa.status === 'ACTIVE' ? 'outline-danger' : 'secondary'}
                              size="sm"
                              onClick={() => handleToggleAccountStatus(sa.id)}
                            >
                              {sa.status === 'ACTIVE' ? 'Revoke' : 'Reactivate'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteAccount(sa.id)}
                              className="text-fg-subtle hover:text-danger"
                              title="Delete service account"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Provision Service Account Modal */}
          {isCreateAccountOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
              <div className="w-full max-w-md rounded-2xl border border-card-border bg-card p-6 shadow-2xl space-y-4">
                <div className="flex items-center justify-between border-b border-card-border pb-3">
                  <div className="flex items-center gap-2">
                    <Key className="h-5 w-5 text-primary" />
                    <h3 className="text-base font-bold text-fg">Create Machine Service Account</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsCreateAccountOpen(false)}
                    className="text-fg-muted hover:text-fg text-sm cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleCreateServiceAccount} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-fg-muted mb-1">
                      Workload / Service Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. DeepSeek Production Reasoning Worker"
                      value={newAccountName}
                      onChange={(e) => setNewAccountName(e.target.value)}
                      className="w-full rounded-lg border border-card-border bg-input-bg px-3 py-2 text-xs text-fg focus:border-primary focus:outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-fg-muted mb-1">
                      Bound Autonomous Agent
                    </label>
                    <select
                      value={newAccountAgentAddr}
                      onChange={(e) => setNewAccountAgentAddr(e.target.value)}
                      className="w-full rounded-lg border border-card-border bg-input-bg px-3 py-2 text-xs text-fg focus:border-primary focus:outline-none"
                    >
                      {agents.map((agent) => (
                        <option key={agent.address} value={agent.address}>
                          {agent.name} ({agent.address.slice(0, 6)}...{agent.address.slice(-4)})
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-fg-subtle">
                      All LLM inference calls made using this key will settle spending against this agent's onchain Monad policy.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-fg-muted mb-1">
                      Assigned RBAC Role
                    </label>
                    <select
                      value={newAccountRole}
                      onChange={(e) => setNewAccountRole(e.target.value as OperatorRole)}
                      className="w-full rounded-lg border border-card-border bg-input-bg px-3 py-2 text-xs text-fg focus:border-primary focus:outline-none"
                    >
                      <option value="agent_developer">Agent Developer (Self-serve execution)</option>
                      <option value="fleet_devops">Fleet DevOps (Telemetry &amp; lifecycle)</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-card-border">
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      onClick={() => setIsCreateAccountOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button variant="primary" size="sm" type="submit">
                      Issue Machine Key
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Provision Operator Modal */}
      <ProvisionOperatorModal
        isOpen={isProvisionModalOpen}
        onClose={() => setIsProvisionModalOpen(false)}
      />
    </div>
  );
};

export default AccessManagementView;
