import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useState } from "react";
import { request, toUserFacingError, usePlatformTenants, type PlatformTenant } from "../../api";
import { Badge, Button, EmptyState, Mono, Surface, TextField } from "../../design-system";
import { useIdentity } from "../../identity";

const tenantFeatures = tableFeatures({});
const tenantColumnHelper = createColumnHelper<typeof tenantFeatures, PlatformTenant>();
const tenantColumns = tenantColumnHelper.columns([
  tenantColumnHelper.accessor("displayName", { header: "Organization" }),
  tenantColumnHelper.accessor("enterpriseAddress", {
    header: "Enterprise wallet",
    cell: (info) => <Mono>{info.getValue()}</Mono>,
  }),
  tenantColumnHelper.accessor("status", {
    header: "Status",
    cell: (info) => <Badge tone={info.getValue() === "active" ? "success" : "neutral"}>{info.getValue()}</Badge>,
  }),
  tenantColumnHelper.accessor("createdAt", {
    header: "Created",
    cell: (info) => new Date(info.getValue()).toLocaleDateString(),
  }),
]);

export function AdminTenants() {
  const identity = useIdentity();
  const tenants = usePlatformTenants(identity.platformAccess);
  const [tenantMessage, setTenantMessage] = useState("");
  const [tenantForm, setTenantForm] = useState({ displayName: "", enterpriseAddress: "", ownerSubject: "" });
  const table = useTable({ data: tenants.data ?? [], columns: tenantColumns, features: tenantFeatures });
  const createTenant = async () => {
    try {
      await request("/platform/tenants", { method: "POST", body: JSON.stringify(tenantForm) });
      setTenantForm({ displayName: "", enterpriseAddress: "", ownerSubject: "" });
      setTenantMessage("Organization created and assigned to its first operator.");
      void tenants.refetch();
    } catch (error) {
      setTenantMessage(toUserFacingError(error, "The organization could not be created."));
    }
  };
  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Admin / Tenants</span>
          <h1>Tenants</h1>
          <p>Provision organizations and monitor lifecycle state.</p>
        </div>
      </header>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Create an organization</h2>
            <p>Platform operators can provision a tenant for an invited owner.</p>
          </div>
        </div>
        <div className="form-grid">
          {(["displayName", "enterpriseAddress", "ownerSubject"] as const).map((key) => (
            <TextField
              key={key}
              value={tenantForm[key]}
              onChange={(event) => setTenantForm({ ...tenantForm, [key]: event.target.value })}
              label={
                key === "enterpriseAddress"
                  ? "Enterprise wallet address"
                  : key === "ownerSubject"
                    ? "Owner identity subject"
                    : "Organization name"
              }
            />
          ))}
          <Button
            onClick={() => void createTenant()}
            disabled={!tenantForm.displayName || !tenantForm.enterpriseAddress || !tenantForm.ownerSubject}
          >
            Create organization
          </Button>
        </div>
        {tenantMessage && <p className="form-message">{tenantMessage}</p>}
      </Surface>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Tenant directory</h2>
            <p>{tenants.data?.length ?? 0} organizations on the platform.</p>
          </div>
        </div>
        {tenants.isError ? (
          <EmptyState title="Tenant directory unavailable" detail="We couldn't load the tenant directory right now." />
        ) : tenants.data?.length ? (
          <div className="table-viewport">
            <table>
              <thead>
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => (
                      <th key={header.id}>{header.isPlaceholder ? null : <table.FlexRender header={header} />}</th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getAllCells().map((cell) => (
                      <td key={cell.id}>
                        <table.FlexRender cell={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No tenants registered" detail="The platform directory is empty." />
        )}
      </Surface>
    </div>
  );
}
