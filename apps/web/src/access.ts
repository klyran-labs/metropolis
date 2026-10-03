/**
 * Which navigation destinations are useful to which tenant role. This mirrors the gateway's
 * role matrix (`services/gateway/src/rbac.rs`) for display only: hiding a link never grants or
 * removes access, the gateway stays authoritative. Unknown roles see everything so nothing
 * flickers away while the role is still loading.
 */
const SETTLEMENT_ROLES = ["super_admin", "treasury"];
const TREASURY_VISIBLE_ROLES = ["super_admin", "treasury", "sec_ops", "auditor"];

const ROLE_RESTRICTED_DESTINATIONS: Record<string, string[]> = {
  "/app/billing": SETTLEMENT_ROLES,
  "/app/quorum": SETTLEMENT_ROLES,
  "/app/treasury": TREASURY_VISIBLE_ROLES,
};

export function canViewDestination(role: string | null | undefined, path: string): boolean {
  if (!role) return true;
  const allowed = ROLE_RESTRICTED_DESTINATIONS[path];
  return allowed ? allowed.includes(role) : true;
}
