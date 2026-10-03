export const ASSIGNABLE_CAPABILITIES = [
  { value: "fleet.read", label: "View agents" },
  { value: "audit.read", label: "View activity history" },
  { value: "telemetry.subscribe", label: "View live activity" },
  { value: "policy.write", label: "Edit spending rules" },
  { value: "circuit_breaker.trip", label: "Pause agents" },
  { value: "treasury.manage", label: "Manage treasury" },
  { value: "settlement.dispatch", label: "Send payments" },
] as const;

export function capabilityLabel(value: string): string {
  return ASSIGNABLE_CAPABILITIES.find((c) => c.value === value)?.label ?? value;
}

export function canManageSecurity(role: string | null | undefined): boolean {
  return role === "super_admin" || role === "sec_ops";
}

export function defaultExpiryInput(): string {
  const date = new Date();
  date.setDate(date.getDate() + 90);
  return date.toISOString().slice(0, 10);
}


export function canManagePricing(role: string | null | undefined): boolean {
  return role === "super_admin" || role === "treasury" || role === "sec_ops";
}

