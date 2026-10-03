import { useState } from "react";
import { configuration } from "../../configuration";
import { request, toUserFacingError, usePlatformPlans } from "../../api";
import { Badge, Button, CurrencyInput, EmptyState, Select, Surface, TextField, TokenAmount } from "../../design-system";
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
  const fields = ["code", "name", "description"] as const;
  const fieldLabels: Record<(typeof fields)[number], string> = {
    code: "Plan code",
    name: "Plan name",
    description: "Description",
  };
  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <h1>Plans</h1>
          <p>Publish and manage subscription pricing tiers.</p>
        </div>
      </header>
      <Surface>
        <div className="section-heading">
          <h2>Create plan</h2>
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
          <div className="stack" style={{ gap: "4px" }}>
            <label className="field-group-label">Price</label>
            <CurrencyInput
              valueBaseUnits={form.amount}
              onChangeBaseUnits={(next) => setForm({ ...form, amount: next })}
              decimals={6}
            />
          </div>
          <Select
            label="Currency"
            value={form.token}
            onChange={(val) => setForm({ ...form, token: val })}
            options={[{ value: configuration.contracts.settlementToken ?? "", label: "USDC" }]}
          />
          <Select
            label="Billing interval"
            value={form.interval}
            onChange={(val) => setForm({ ...form, interval: val })}
            options={[
              { value: "monthly", label: "Monthly" },
              { value: "annual", label: "Annual" },
            ]}
          />
          <Button onClick={create}>Publish plan</Button>
        </div>
        {message && <p className="form-message">{message}</p>}
      </Surface>
      <Surface>
        <div className="section-heading">
          <h2>Plans</h2>
        </div>
        {plans.isError || !identity.platformAccess ? (
          <EmptyState kind="warning" title="Couldn't load plans" detail="A platform role is required to view plans." />
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
          <EmptyState kind="billing" title="No plans yet" detail="Create your first plan above." />
        )}
      </Surface>
    </div>
  );
}
