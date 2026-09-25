import { useState } from "react";
import { configuration } from "../../configuration";
import { request, toUserFacingError, usePlatformPlans } from "../../api";
import { Badge, Button, EmptyState, Surface, TextField, TokenAmount } from "../../design-system";
import { useIdentity } from "../../identity";

export function AdminPlans() {
  const identity = useIdentity();
  const plans = usePlatformPlans(identity.platformAccess);
  const [form, setForm] = useState({
    code: "",
    name: "",
    description: "",
    amount: "",
    token: configuration.contracts.settlementToken ?? "",
    interval: "monthly",
  });
  const [message, setMessage] = useState("");
  const create = async () => {
    try {
      await request("/platform/plans", {
        method: "POST",
        body: JSON.stringify({
          code: form.code,
          name: form.name,
          description: form.description,
          prices: [
            {
              chainId: configuration.chainId,
              tokenAddress: form.token,
              amountBaseUnits: form.amount,
              interval: form.interval,
            },
          ],
        }),
      });
      setMessage("Plan created.");
      void plans.refetch();
    } catch (error) {
      setMessage(toUserFacingError(error, "The plan could not be created."));
    }
  };
  const fields = ["code", "name", "description", "amount", "token"] as const;
  const fieldLabels: Record<(typeof fields)[number], string> = {
    code: "Plan code",
    name: "Plan name",
    description: "Description",
    amount: "Price (e.g. 1000000 = $1.00)",
    token: "Settlement token address",
  };
  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Admin / Plans</span>
          <h1>Plans and pricing</h1>
          <p>Publish real prices bound to the active chain and settlement token.</p>
        </div>
      </header>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Create a plan</h2>
            <p>Prices must be bound to the active chain and configured settlement token.</p>
          </div>
        </div>
        <div className="admin-form-grid">
          {fields.map((key) => (
            <TextField
              key={key}
              value={form[key]}
              onChange={(event) => setForm({ ...form, [key]: event.target.value })}
              label={fieldLabels[key]}
            />
          ))}
          <select value={form.interval} onChange={(event) => setForm({ ...form, interval: event.target.value })}>
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
          <Button onClick={create}>Publish plan</Button>
        </div>
        {message && <p className="form-message">{message}</p>}
      </Surface>
      <Surface>
        <div className="section-heading">
          <div>
            <h2>Plan catalog</h2>
            <p>Every plan and price currently published on the platform.</p>
          </div>
        </div>
        {plans.isError || !identity.platformAccess ? (
          <EmptyState title="Plan catalog unavailable" detail="A platform role is required to view plans, and the service must be reachable." />
        ) : plans.data?.length ? (
          <div className="pricing-cards">
            {plans.data.map((plan) => (
              <div className="pricing-card" key={plan.id}>
                <span className="card-kicker">{plan.code}</span>
                <strong>{plan.name}</strong>
                <p>{plan.description}</p>
                {plan.prices.map((price) => (
                  <div className="pricing-amount" key={price.id}>
                    <TokenAmount baseUnits={price.amountBaseUnits} />
                    <small> / {price.interval}</small>
                  </div>
                ))}
                <Badge tone={plan.active ? "success" : "neutral"}>{plan.active ? "Active" : "Inactive"}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No plans published" detail="Create your first subscription plan above." />
        )}
      </Surface>
    </div>
  );
}
