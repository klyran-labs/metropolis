use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    SuperAdmin,
    SecOps,
    Treasury,
    FleetDevops,
    AgentDeveloper,
    Auditor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlatformRole {
    PlatformSuperAdmin,
    PlatformOperations,
    PlatformSecurity,
    PlatformBilling,
    PlatformSupport,
    PlatformAuditor,
    PlatformViewer,
}

impl PlatformRole {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "platform_super_admin" => Some(Self::PlatformSuperAdmin),
            "platform_operations" => Some(Self::PlatformOperations),
            "platform_security" => Some(Self::PlatformSecurity),
            "platform_billing" => Some(Self::PlatformBilling),
            "platform_support" => Some(Self::PlatformSupport),
            "platform_auditor" => Some(Self::PlatformAuditor),
            "platform_viewer" => Some(Self::PlatformViewer),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PlatformSuperAdmin => "platform_super_admin",
            Self::PlatformOperations => "platform_operations",
            Self::PlatformSecurity => "platform_security",
            Self::PlatformBilling => "platform_billing",
            Self::PlatformSupport => "platform_support",
            Self::PlatformAuditor => "platform_auditor",
            Self::PlatformViewer => "platform_viewer",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlatformCapability {
    ReadTenants,
    ManageTenants,
    ManagePlans,
    ManageSubscriptions,
    ReadBilling,
    ManagePlatformAccess,
}

pub fn platform_role_allows(role: PlatformRole, capability: PlatformCapability) -> bool {
    match role {
        PlatformRole::PlatformSuperAdmin => true,
        PlatformRole::PlatformOperations => matches!(
            capability,
            PlatformCapability::ReadTenants
                | PlatformCapability::ManageTenants
                | PlatformCapability::ManageSubscriptions
        ),
        PlatformRole::PlatformSecurity => matches!(capability, PlatformCapability::ReadTenants),
        PlatformRole::PlatformBilling => matches!(
            capability,
            PlatformCapability::ReadTenants
                | PlatformCapability::ManageTenants
                | PlatformCapability::ManagePlans
                | PlatformCapability::ManageSubscriptions
                | PlatformCapability::ReadBilling
        ),
        PlatformRole::PlatformSupport => matches!(
            capability,
            PlatformCapability::ReadTenants
                | PlatformCapability::ManageTenants
                | PlatformCapability::ManageSubscriptions
        ),
        PlatformRole::PlatformAuditor => matches!(
            capability,
            PlatformCapability::ReadTenants | PlatformCapability::ReadBilling
        ),
        PlatformRole::PlatformViewer => matches!(capability, PlatformCapability::ReadTenants),
    }
}

impl Role {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "super_admin" => Some(Self::SuperAdmin),
            "sec_ops" => Some(Self::SecOps),
            "treasury" => Some(Self::Treasury),
            "fleet_devops" => Some(Self::FleetDevops),
            "agent_developer" => Some(Self::AgentDeveloper),
            "auditor" => Some(Self::Auditor),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SuperAdmin => "super_admin",
            Self::SecOps => "sec_ops",
            Self::Treasury => "treasury",
            Self::FleetDevops => "fleet_devops",
            Self::AgentDeveloper => "agent_developer",
            Self::Auditor => "auditor",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Capability {
    ReadFleet,
    ReadAudit,
    SubscribeTelemetry,
    ManageIam,
    AuthorPolicy,
    TripCircuitBreaker,
    ManageTreasury,
    DispatchSettlement,
}

impl Capability {
    pub const fn action(self) -> &'static str {
        match self {
            Self::ReadFleet => "fleet.read",
            Self::ReadAudit => "audit.read",
            Self::SubscribeTelemetry => "telemetry.subscribe",
            Self::ManageIam => "iam.manage",
            Self::AuthorPolicy => "policy.write",
            Self::TripCircuitBreaker => "circuit_breaker.trip",
            Self::ManageTreasury => "treasury.manage",
            Self::DispatchSettlement => "settlement.dispatch",
        }
    }
}

pub fn role_allows(role: Role, capability: Capability) -> bool {
    match role {
        Role::SuperAdmin => true,
        Role::SecOps => matches!(
            capability,
            Capability::ReadFleet
                | Capability::ReadAudit
                | Capability::SubscribeTelemetry
                | Capability::TripCircuitBreaker
        ),
        Role::Treasury => matches!(
            capability,
            Capability::ReadFleet
                | Capability::ReadAudit
                | Capability::SubscribeTelemetry
                | Capability::ManageTreasury
                | Capability::DispatchSettlement
        ),
        Role::FleetDevops => matches!(
            capability,
            Capability::ReadFleet | Capability::ReadAudit | Capability::SubscribeTelemetry
        ),
        Role::AgentDeveloper => matches!(
            capability,
            Capability::ReadFleet
                | Capability::ReadAudit
                | Capability::SubscribeTelemetry
                | Capability::AuthorPolicy
                | Capability::TripCircuitBreaker
        ),
        Role::Auditor => matches!(
            capability,
            Capability::ReadFleet | Capability::ReadAudit | Capability::SubscribeTelemetry
        ),
    }
}
