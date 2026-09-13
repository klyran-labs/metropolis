import { type Address } from 'viem';
import { type OperatorRole } from '../context/RbacContext';

export type OperatorStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED';

export interface OperatorUser {
  id: string;
  address: Address;
  name: string;
  email?: string;
  privyDid?: string;
  role: OperatorRole;
  status: OperatorStatus;
  assignedAt: string; // ISO 8601
  assignedBy: Address;
  lastActiveAt?: string;
}

export type RoleActionType = 'ASSIGN' | 'REASSIGN' | 'SUSPEND' | 'ACTIVATE' | 'REVOKE';

export interface RoleAuditEvent {
  id: string;
  timestamp: string;
  actorAddress: Address;
  targetAddress: Address;
  targetName: string;
  previousRole: OperatorRole | null;
  newRole: OperatorRole | null;
  action: RoleActionType;
  notes?: string;
}
