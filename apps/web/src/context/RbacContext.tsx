import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { type Address } from 'viem';
import { type OperatorUser, type RoleAuditEvent, type OperatorStatus } from '../types/access';
import monadTestnetContracts from '@deployments/monad-testnet/contracts.json';

export type OperatorRole = 'super_admin' | 'sec_ops' | 'treasury' | 'fleet_devops' | 'agent_developer' | 'auditor';

export interface RoleDefinition {
  id: OperatorRole;
  label: string;
  badge: string;
  icon: string;
  color: string;
  description: string;
  permissions: {
    canToggleKillSwitch: boolean;
    canEditPolicy: boolean;
    canManageBudgetPools: boolean;
    canRegisterAgents: boolean;
    canRunSimulations: boolean;
    canExportAudit: boolean;
    canManageAccess: boolean;
    isReadOnly: boolean;
  };
}

export const OPERATOR_ROLES: Record<OperatorRole, RoleDefinition> = {
  super_admin: {
    id: 'super_admin',
    label: 'Super Admin',
    badge: 'Super Admin',
    icon: '👑',
    color: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-400 dark:border-indigo-700/40',
    description: 'Full Root: Policy modification, emergency freeze, pool allocation, team access management, and governance.',
    permissions: {
      canToggleKillSwitch: true,
      canEditPolicy: true,
      canManageBudgetPools: true,
      canRegisterAgents: true,
      canRunSimulations: true,
      canExportAudit: true,
      canManageAccess: true,
      isReadOnly: false,
    },
  },
  sec_ops: {
    id: 'sec_ops',
    label: 'Risk & SecOps',
    badge: 'SecOps Active',
    icon: '🛡️',
    color: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-400 dark:border-rose-700/40',
    description: 'Emergency stop authority, risk telemetry, adversarial scenario testing, and policy attestation.',
    permissions: {
      canToggleKillSwitch: true,
      canEditPolicy: false,
      canManageBudgetPools: false,
      canRegisterAgents: false,
      canRunSimulations: true,
      canExportAudit: true,
      canManageAccess: false,
      isReadOnly: false,
    },
  },
  treasury: {
    id: 'treasury',
    label: 'Treasury Manager',
    badge: 'Treasury Guard',
    icon: '💼',
    color: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-700/40',
    description: 'Finance authority: Budget Pool allocations, spend ceilings, merchant whitelists, and window limits.',
    permissions: {
      canToggleKillSwitch: false,
      canEditPolicy: true,
      canManageBudgetPools: true,
      canRegisterAgents: false,
      canRunSimulations: false,
      canExportAudit: true,
      canManageAccess: false,
      isReadOnly: false,
    },
  },
  fleet_devops: {
    id: 'fleet_devops',
    label: 'Fleet DevOps',
    badge: 'Fleet Ops',
    icon: '🤖',
    color: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-400 dark:border-blue-700/40',
    description: 'Agent orchestration: Onboarding new agents, keypair association, lifecycle telemetry, and runtime monitoring.',
    permissions: {
      canToggleKillSwitch: false,
      canEditPolicy: false,
      canManageBudgetPools: false,
      canRegisterAgents: true,
      canRunSimulations: true,
      canExportAudit: true,
      canManageAccess: false,
      isReadOnly: false,
    },
  },
  agent_developer: {
    id: 'agent_developer',
    label: 'Agent Developer',
    badge: 'Agent Developer',
    icon: '⚡',
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-700/40',
    description: 'Autonomous Agent Owner: Provision isolated bot wallets, configure spend limits, toggle kill-switches, and inspect telemetry.',
    permissions: {
      canToggleKillSwitch: true,
      canEditPolicy: true,
      canManageBudgetPools: false,
      canRegisterAgents: true,
      canRunSimulations: true,
      canExportAudit: true,
      canManageAccess: false,
      isReadOnly: false,
    },
  },
  auditor: {
    id: 'auditor',
    label: 'Compliance Auditor',
    badge: 'Auditor (Read-Only)',
    icon: '📋',
    color: 'bg-card-muted text-fg-muted border-card-border',
    description: 'Independent oversight: Cryptographic audit ledger verification, CSV/JSON evidence export, and regulatory attestation.',
    permissions: {
      canToggleKillSwitch: false,
      canEditPolicy: false,
      canManageBudgetPools: false,
      canRegisterAgents: false,
      canRunSimulations: false,
      canExportAudit: true,
      canManageAccess: false,
      isReadOnly: true,
    },
  },
};

export type RoleSource =
  | 'privy_jwt'
  | 'privy_metadata'
  | 'operator_directory'
  | 'root_authority'
  | 'least_privilege_default';

/**
 * Safely decodes a JWT payload without external libraries.
 * Handles both browser atob/TextDecoder and Node.js Buffer environments.
 */
export function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');

    if (typeof window === 'undefined') {
      const json = Buffer.from(base64, 'base64').toString('utf8');
      return JSON.parse(json);
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const decodedText = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(decodedText);
  } catch {
    return null;
  }
}

/**
 * Inspects a decoded JWT payload for standardized and custom role claims.
 */
export function extractRoleFromJwtPayload(payload: Record<string, any> | null): OperatorRole | null {
  if (!payload || typeof payload !== 'object') return null;

  const candidate =
    payload.role ||
    payload.custom_metadata?.role ||
    payload.customMetadata?.role ||
    payload['https://agentguard.io/role'] ||
    payload['agentguard:role'] ||
    payload.app_metadata?.role ||
    payload.user_metadata?.role;

  if (typeof candidate === 'string' && candidate in OPERATOR_ROLES) {
    return candidate as OperatorRole;
  }
  return null;
}

export interface RbacContextValue {
  role: OperatorRole;
  roleConfig: RoleDefinition;
  authenticatedRole: OperatorRole;
  roleSource: RoleSource;
  jwtRole: OperatorRole | null;
  jwtClaims: Record<string, any> | null;
  isJwtLoading: boolean;
  isImpersonating: boolean;
  canImpersonate: boolean;
  assumeRole: (role: OperatorRole) => void;
  exitImpersonation: () => void;
  setRole: (role: OperatorRole) => void;
  isAssumeModalOpen: boolean;
  setIsAssumeModalOpen: (open: boolean) => void;
  can: (permission: keyof RoleDefinition['permissions']) => boolean;
  // Operator Directory & Access Management
  operators: OperatorUser[];
  roleAuditLog: RoleAuditEvent[];
  provisionOperator: (data: { address: Address; role: OperatorRole; name: string; email?: string; privyDid?: string }) => void;
  assignRole: (operatorAddress: Address, newRole: OperatorRole) => void;
  toggleOperatorStatus: (operatorAddress: Address, newStatus: OperatorStatus) => void;
  revokeOperator: (operatorAddress: Address) => void;
  syncRoleToPrivy: (targetDid: string, role: OperatorRole) => Promise<{ success: boolean; message: string }>;
}

const STORAGE_KEY = 'AGENTGUARD_SIMULATED_ROLE';
const OPERATORS_STORAGE_KEY = 'AGENTGUARD_OPERATORS_DIRECTORY';
const AUDIT_STORAGE_KEY = 'AGENTGUARD_IAM_AUDIT_LOG';

const RbacContext = createContext<RbacContextValue | null>(null);

export const RbacProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, authenticated, getAccessToken } = usePrivy();
  const [isAssumeModalOpen, setIsAssumeModalOpen] = useState(false);

  // 1. Operators Directory State
  const [operators, setOperators] = useState<OperatorUser[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(OPERATORS_STORAGE_KEY);
        if (saved) return JSON.parse(saved);
      } catch {
        // quiet fallback
      }
    }
    return [];
  });

  // 2. IAM Audit Log State
  const [roleAuditLog, setRoleAuditLog] = useState<RoleAuditEvent[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(AUDIT_STORAGE_KEY);
        if (saved) return JSON.parse(saved);
      } catch {
        // quiet fallback
      }
    }
    return [];
  });

  // 3. Cryptographic Privy Access Token (JWT) inspection state
  const [jwtRole, setJwtRole] = useState<OperatorRole | null>(null);
  const [jwtClaims, setJwtClaims] = useState<Record<string, any> | null>(null);
  const [isJwtLoading, setIsJwtLoading] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    if (!authenticated) {
      setJwtRole(null);
      setJwtClaims(null);
      setIsJwtLoading(false);
      return;
    }

    if (typeof getAccessToken === 'function') {
      setIsJwtLoading(true);
      getAccessToken()
        .then((token) => {
          if (!isMounted) return;
          if (token) {
            const payload = decodeJwtPayload(token);
            setJwtClaims(payload);
            const extracted = extractRoleFromJwtPayload(payload);
            setJwtRole(extracted);
          } else {
            setJwtRole(null);
            setJwtClaims(null);
          }
        })
        .catch((err) => {
          console.warn('Unable to retrieve Privy access token for JWT role inspection:', err);
          if (isMounted) {
            setJwtRole(null);
            setJwtClaims(null);
          }
        })
        .finally(() => {
          if (isMounted) setIsJwtLoading(false);
        });
    }

    return () => {
      isMounted = false;
    };
  }, [authenticated, user, getAccessToken]);

  // Persist Operators to localStorage
  const persistOperators = useCallback((list: OperatorUser[]) => {
    setOperators(list);
    try {
      localStorage.setItem(OPERATORS_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // quiet fallback
    }
  }, []);

  // Persist Audit Log to localStorage
  const appendAuditLog = useCallback((event: RoleAuditEvent) => {
    setRoleAuditLog((prev) => {
      const next = [event, ...prev];
      try {
        localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // quiet fallback
      }
      return next;
    });
  }, []);

  // Helper: Verify if an identity has cryptographic or institutional Super Admin authority
  const isSuperAdminAuthorized = useCallback((address?: string, email?: string, metaRole?: string, tokenRole?: string): boolean => {
    // 1. Explicit Privy JWT Claim
    if (tokenRole === 'super_admin') return true;

    // 2. Explicit Privy Server Metadata
    if (metaRole === 'super_admin') return true;

    // 3. Designated root email for developer / demo admin
    if (email && (email === 'demo@kt.com' || email.toLowerCase().endsWith('@agentguard.io'))) {
      return true;
    }

    // 4. Configured root deployer / treasury address from onchain deployments
    const rootAddress = (monadTestnetContracts as any).protocolTreasury?.toLowerCase();
    if (address && rootAddress && address.toLowerCase() === rootAddress) {
      return true;
    }

    // 5. Custom Root Admin Address from environment override
    const envRoot = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_ROOT_ADMIN_ADDRESS)?.toLowerCase();
    if (address && envRoot && address.toLowerCase() === envRoot) {
      return true;
    }

    return false;
  }, []);

  // Sync connected user into directory if needed (Principle of Least Privilege)
  useEffect(() => {
    if (authenticated && user?.wallet?.address) {
      const addr = user.wallet.address.toLowerCase() as Address;
      const email = user.email?.address;
      const metaRole = user.customMetadata?.role as OperatorRole | undefined;

      setOperators((prev) => {
        const existingIndex = prev.findIndex((o) => o.address.toLowerCase() === addr);
        const isAuthorizedRoot = isSuperAdminAuthorized(addr, email, metaRole, jwtRole || undefined);
        const authoritativeRole = jwtRole && OPERATOR_ROLES[jwtRole]
          ? jwtRole
          : metaRole && OPERATOR_ROLES[metaRole]
          ? metaRole
          : isAuthorizedRoot
          ? 'super_admin'
          : 'agent_developer';

        // If operator already exists, sync Privy JWT / customMetadata if it changed
        if (existingIndex >= 0) {
          const currentRecorded = prev[existingIndex].role;
          const currentDid = prev[existingIndex].privyDid;
          if ((authoritativeRole && currentRecorded !== authoritativeRole) || (!currentDid && user.id)) {
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              privyDid: user.id || updated[existingIndex].privyDid,
              role: authoritativeRole || currentRecorded,
              name: email || updated[existingIndex].name,
              lastActiveAt: new Date().toISOString(),
            };
            try {
              localStorage.setItem(OPERATORS_STORAGE_KEY, JSON.stringify(updated));
            } catch {
              // quiet fallback
            }
            return updated;
          }
          return prev;
        }

        // New operator: Strict Least Privilege (agent_developer unless verified root/token)
        const newOperator: OperatorUser = {
          id: `usr_${user.id.slice(-6)}`,
          address: user.wallet!.address as Address,
          name: email || (authoritativeRole === 'super_admin' ? 'Primary Root Admin' : authoritativeRole === 'agent_developer' ? 'Agent Developer (Owner)' : 'Auditor (Read-Only)'),
          email,
          privyDid: user.id,
          role: authoritativeRole,
          status: 'ACTIVE',
          assignedAt: new Date().toISOString(),
          assignedBy: authoritativeRole === 'super_admin' ? (user.wallet!.address as Address) : ('0x0000000000000000000000000000000000000000' as Address),
          lastActiveAt: new Date().toISOString(),
        };
        const next = [newOperator, ...prev];
        try {
          localStorage.setItem(OPERATORS_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // quiet fallback
        }
        return next;
      });
    }
  }, [authenticated, user, jwtRole, isSuperAdminAuthorized]);

  // 4. Resolve Authenticated Role with Fallback Pipeline (Zero-Trust & Least Privilege)
  const { authenticatedRole, roleSource } = useMemo<{ authenticatedRole: OperatorRole; roleSource: RoleSource }>(() => {
    // Unauthenticated visitors or guests are strictly read-only auditors
    if (!authenticated || !user) {
      return { authenticatedRole: 'auditor', roleSource: 'least_privilege_default' };
    }

    // Tier 1: Cryptographically signed Privy JWT Token Claim
    if (jwtRole && OPERATOR_ROLES[jwtRole]) {
      return { authenticatedRole: jwtRole, roleSource: 'privy_jwt' };
    }

    // Tier 2: Authoritative Identity Provider (Privy User customMetadata)
    const metaRole = user.customMetadata?.role as OperatorRole | undefined;
    if (metaRole && OPERATOR_ROLES[metaRole]) {
      return { authenticatedRole: metaRole, roleSource: 'privy_metadata' };
    }

    // Tier 3: Enterprise Operators Directory (Managed by verified Super Admins)
    if (user.wallet?.address) {
      const currentAddr = user.wallet.address.toLowerCase();
      const matched = operators.find((o) => o.address.toLowerCase() === currentAddr);
      if (matched && matched.status === 'ACTIVE' && OPERATOR_ROLES[matched.role]) {
        return { authenticatedRole: matched.role, roleSource: 'operator_directory' };
      }
    }

    // Tier 4: Cryptographic Deployer Wallet or Designated Root Authority
    const email = user.email?.address;
    const addr = user.wallet?.address;
    if (isSuperAdminAuthorized(addr, email, metaRole, jwtRole || undefined)) {
      return { authenticatedRole: 'super_admin', roleSource: 'root_authority' };
    }

    // Tier 5: Authenticated User Least-Privilege Fallback: Agent Developer (Active Owner)
    return { authenticatedRole: 'agent_developer', roleSource: 'least_privilege_default' };
  }, [authenticated, user, jwtRole, operators, isSuperAdminAuthorized]);

  // 4. Only Super Admin has authority to enter Impersonation / Simulation Mode
  const canImpersonate = authenticatedRole === 'super_admin';

  // 5. Simulated role (active only if canImpersonate)
  const [simulatedRole, setSimulatedRole] = useState<OperatorRole | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY) as OperatorRole;
        if (saved && OPERATOR_ROLES[saved]) {
          return saved;
        }
      } catch {
        // quiet fallback
      }
    }
    return null;
  });

  const isImpersonating = canImpersonate && simulatedRole !== null && simulatedRole !== authenticatedRole;
  const activeRole: OperatorRole = isImpersonating ? simulatedRole : authenticatedRole;
  const roleConfig = OPERATOR_ROLES[activeRole] || OPERATOR_ROLES.super_admin;

  const assumeRole = (newRole: OperatorRole) => {
    if (!canImpersonate) {
      console.warn('Unauthorized: Role impersonation requires Super Admin authority.');
      return;
    }
    setSimulatedRole(newRole);
    try {
      localStorage.setItem(STORAGE_KEY, newRole);
    } catch {
      // quiet fallback
    }
  };

  const exitImpersonation = () => {
    setSimulatedRole(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // quiet fallback
    }
  };

  const setRole = (newRole: OperatorRole) => {
    if (canImpersonate) {
      assumeRole(newRole);
    }
  };

  const can = (permission: keyof RoleDefinition['permissions']): boolean => {
    return roleConfig.permissions[permission] ?? false;
  };

  // 6. Access Directory Mutation Methods
  const actorAddress: Address = (user?.wallet?.address as Address) || ('0x1111111111111111111111111111111111111111' as Address);

  const provisionOperator = useCallback(
    (data: { address: Address; role: OperatorRole; name: string; email?: string; privyDid?: string }) => {
      if (!can('canManageAccess')) {
        throw new Error('Unauthorized: Only Super Admin can provision new operators.');
      }
      const newOperator: OperatorUser = {
        id: `usr_${Date.now().toString().slice(-6)}`,
        address: data.address,
        name: data.name.trim(),
        email: data.email?.trim(),
        privyDid: data.privyDid?.trim() || undefined,
        role: data.role,
        status: 'ACTIVE',
        assignedAt: new Date().toISOString(),
        assignedBy: actorAddress,
        lastActiveAt: new Date().toISOString(),
      };

      const updated = [newOperator, ...operators.filter((o) => o.address.toLowerCase() !== data.address.toLowerCase())];
      persistOperators(updated);

      appendAuditLog({
        id: `aud_${Date.now()}`,
        timestamp: new Date().toISOString(),
        actorAddress,
        targetAddress: data.address,
        targetName: data.name,
        previousRole: null,
        newRole: data.role,
        action: 'ASSIGN',
        notes: `Provisioned with role ${OPERATOR_ROLES[data.role].label}${data.privyDid ? ` (DID: ${data.privyDid})` : ''}`,
      });
    },
    [can, operators, actorAddress, persistOperators, appendAuditLog]
  );

  const syncRoleToPrivy = useCallback(
    async (targetDid: string, role: OperatorRole): Promise<{ success: boolean; message: string }> => {
      if (!can('canManageAccess')) {
        throw new Error('Unauthorized: Super Admin authority required to update Privy custom metadata.');
      }
      const token = typeof getAccessToken === 'function' ? await getAccessToken() : null;
      if (!token) {
        throw new Error('Unable to retrieve Privy access token for server authentication.');
      }

      const res = await fetch(`/api/v1/users/${encodeURIComponent(targetDid)}/role`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || `HTTP ${res.status} updating Privy custom metadata`);
      }

      // Update operator in local list with the newly confirmed role
      setOperators((prev) => {
        const updated = prev.map((op) => {
          if (op.privyDid === targetDid) {
            return { ...op, role };
          }
          return op;
        });
        persistOperators(updated);
        return updated;
      });

      appendAuditLog({
        id: `aud_${Date.now()}`,
        timestamp: new Date().toISOString(),
        actorAddress,
        targetAddress: ('0x0000000000000000000000000000000000000000' as Address),
        targetName: targetDid,
        previousRole: null,
        newRole: role,
        action: 'REASSIGN',
        notes: `Synchronized role '${OPERATOR_ROLES[role].label}' to Privy custom metadata`,
      });

      return { success: true, message: `Successfully synced role '${role}' to Privy user ${targetDid}` };
    },
    [can, getAccessToken, persistOperators, appendAuditLog, actorAddress]
  );

  const assignRole = useCallback(
    (operatorAddress: Address, newRole: OperatorRole) => {
      if (!can('canManageAccess')) {
        throw new Error('Unauthorized: Only Super Admin can reassign operator roles.');
      }
      const target = operators.find((o) => o.address.toLowerCase() === operatorAddress.toLowerCase());
      if (!target) return;

      const previousRole = target.role;
      const updated = operators.map((o) =>
        o.address.toLowerCase() === operatorAddress.toLowerCase()
          ? { ...o, role: newRole, assignedAt: new Date().toISOString(), assignedBy: actorAddress }
          : o
      );
      persistOperators(updated);

      appendAuditLog({
        id: `aud_${Date.now()}`,
        timestamp: new Date().toISOString(),
        actorAddress,
        targetAddress: operatorAddress,
        targetName: target.name,
        previousRole,
        newRole,
        action: 'REASSIGN',
        notes: `Role changed from ${OPERATOR_ROLES[previousRole].label} to ${OPERATOR_ROLES[newRole].label}`,
      });
    },
    [can, operators, actorAddress, persistOperators, appendAuditLog]
  );

  const toggleOperatorStatus = useCallback(
    (operatorAddress: Address, newStatus: OperatorStatus) => {
      if (!can('canManageAccess')) {
        throw new Error('Unauthorized: Only Super Admin can toggle operator status.');
      }
      const target = operators.find((o) => o.address.toLowerCase() === operatorAddress.toLowerCase());
      if (!target) return;

      const updated = operators.map((o) =>
        o.address.toLowerCase() === operatorAddress.toLowerCase() ? { ...o, status: newStatus } : o
      );
      persistOperators(updated);

      appendAuditLog({
        id: `aud_${Date.now()}`,
        timestamp: new Date().toISOString(),
        actorAddress,
        targetAddress: operatorAddress,
        targetName: target.name,
        previousRole: target.role,
        newRole: target.role,
        action: newStatus === 'SUSPENDED' ? 'SUSPEND' : 'ACTIVATE',
        notes: `Operator status updated to ${newStatus}`,
      });
    },
    [can, operators, actorAddress, persistOperators, appendAuditLog]
  );

  const revokeOperator = useCallback(
    (operatorAddress: Address) => {
      if (!can('canManageAccess')) {
        throw new Error('Unauthorized: Only Super Admin can revoke operators.');
      }
      const target = operators.find((o) => o.address.toLowerCase() === operatorAddress.toLowerCase());
      if (!target) return;

      const updated = operators.filter((o) => o.address.toLowerCase() !== operatorAddress.toLowerCase());
      persistOperators(updated);

      appendAuditLog({
        id: `aud_${Date.now()}`,
        timestamp: new Date().toISOString(),
        actorAddress,
        targetAddress: operatorAddress,
        targetName: target.name,
        previousRole: target.role,
        newRole: null,
        action: 'REVOKE',
        notes: `Operator revoked and removed from directory`,
      });
    },
    [can, operators, actorAddress, persistOperators, appendAuditLog]
  );

  const value = useMemo<RbacContextValue>(
    () => ({
      role: activeRole,
      roleConfig,
      authenticatedRole,
      roleSource,
      jwtRole,
      jwtClaims,
      isJwtLoading,
      isImpersonating,
      canImpersonate,
      assumeRole,
      exitImpersonation,
      setRole,
      isAssumeModalOpen,
      setIsAssumeModalOpen,
      can,
      operators,
      roleAuditLog,
      provisionOperator,
      assignRole,
      toggleOperatorStatus,
      revokeOperator,
      syncRoleToPrivy,
    }),
    [
      activeRole,
      roleConfig,
      authenticatedRole,
      roleSource,
      jwtRole,
      jwtClaims,
      isJwtLoading,
      isImpersonating,
      canImpersonate,
      isAssumeModalOpen,
      operators,
      roleAuditLog,
      provisionOperator,
      assignRole,
      toggleOperatorStatus,
      revokeOperator,
      syncRoleToPrivy,
    ]
  );

  return <RbacContext.Provider value={value}>{children}</RbacContext.Provider>;
};

export function useRbac(): RbacContextValue {
  const ctx = useContext(RbacContext);
  if (!ctx) {
    throw new Error('useRbac must be used within an RbacProvider');
  }
  return ctx;
}
