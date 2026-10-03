import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useState } from "react";
import { request, toUserFacingError, usePlatformTenants, type PlatformTenant } from "../../api";
import { Badge, Button, EmptyState, Mono, Surface, TextField, TableViewport } from "../../design-system";
import { useIdentity } from "../../identity";
import { formatDate } from "../../format";

const tenantFeatures = tableFeatures({});
const tenantColumnHelper = createColumnHelper<typeof tenantFeatures, PlatformTenant>();
const tenantColumns = tenantColumnHelper.columns([
  tenantColumnHelper.accessor("displayName", { header: "Organization" }),
  tenantColumnHelper.accessor("enterpriseAddress", {
    header: "Payout wallet",
    cell: (info) => <Mono>{info.getValue()}</Mono>,
  }),
  tenantColumnHelper.accessor("status", {
    header: "Status",
    cell: (info) => <Badge tone={info.getValue() === "active" ? "success" : "neutral"}>{info.getValue()}</Badge>,
  }),
  tenantColumnHelper.accessor("createdAt", {
    header: "Created",
    cell: (info) => formatDate(info.getValue()),
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
          <h1>Organizations</h1>
          <p>Add customers and see who is active.</p>
        </div>
      </header>
      <Surface>
        <div className="section-heading">
          <h2>Add organization</h2>
        </div>
        <div className="admin-form-grid">
          {(["displayName", "enterpriseAddress", "ownerSubject"] as const).map((key) => (
            <div key={key} className="stack" style={{ gap: "4px" }}>
              <TextField
                value={tenantForm[key]}
                onChange={(event) => setTenantForm({ ...tenantForm, [key]: event.target.value })}
                label={
                  key === "enterpriseAddress"
                    ? "Payout wallet address"
                    : key === "ownerSubject"
                      ? "Owner account ID"
                      : "Organization name"
                }
              />
              <small className="subtle">
                {key === "enterpriseAddress"
                  ? "Where this tenant's settlements are sent"
                  : key === "ownerSubject"
                    ? "The account that will own and administer this organization"
                    : "Shown throughout the dashboard"}
              </small>
            </div>
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
          <h2>Organizations ({tenants.data?.length ?? 0})</h2>
        </div>
        {tenants.isError ? (
          <EmptyState kind="warning" title="Couldn't load organizations" detail="Try refreshing the page." />
        ) : tenants.data?.length ? (
          <TableViewport label="Organizations">
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
          </TableViewport>
        ) : (
          <EmptyState kind="neutral" title="No organizations yet" detail="Add your first organization above." />
        )}
      </Surface>
    </div>
  );
}
