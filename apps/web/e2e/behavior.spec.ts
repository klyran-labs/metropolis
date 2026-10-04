import { expect, test } from "./support/test";
import { installGateway } from "./support/fixtures";

test.describe("policy: test before you publish", () => {
  test("a sample payment is judged against the limits being edited", async ({ page }) => {
    await installGateway(page);
    await page.goto("/app/policy");
    await page.getByRole("button", { name: /Select an autonomous agent|Research assistant/ }).first().click();
    await page.getByRole("option", { name: /Research assistant/ }).click();

    await page.getByLabel("Maximum per transaction ($ USDC)").fill("10");
    await page.getByLabel("Maximum per window ($ USDC)").fill("100");
    await page.getByText("Advanced tools").click();

    const panel = page.locator(".policy-dryrun-section");
    const amount = panel.getByLabel("Amount (USDC)");

    // Over the per-payment limit: blocked, with a reason a person can act on.
    await amount.fill("15");
    await expect(panel.getByText("Would be blocked", { exact: true })).toBeVisible();
    await expect(panel).toContainText("over the per-transaction limit");

    // Exactly at the limit: allowed.
    await amount.fill("10");
    await expect(panel.getByText("Would go through", { exact: true })).toBeVisible();

    // Raising the limit changes the answer for the same amount.
    await amount.fill("15");
    await page.getByLabel("Maximum per transaction ($ USDC)").fill("20");
    await expect(panel.getByText("Would go through", { exact: true })).toBeVisible();

    // Pausing the agent blocks everything, whatever the amount.
    await page.locator('.modern-switch:has(input[aria-label="Pause this agent"])').click();
    await expect(page.getByLabel("Pause this agent")).toBeChecked();
    await expect(panel.getByText("Would be blocked", { exact: true })).toBeVisible();
    await expect(panel).toContainText("paused");
  });

  test("an unapproved recipient is blocked only when approved merchants are required", async ({ page }) => {
    await installGateway(page);
    await page.goto("/app/policy");
    await page.getByRole("button", { name: /Select an autonomous agent|Research assistant/ }).first().click();
    await page.getByRole("option", { name: /Research assistant/ }).click();
    await page.getByLabel("Maximum per transaction ($ USDC)").fill("50");
    await page.getByLabel("Maximum per window ($ USDC)").fill("500");
    await page.getByText("Advanced tools").click();

    const panel = page.locator(".policy-dryrun-section");
    await panel.getByLabel("Amount (USDC)").fill("5");
    await panel.getByRole("button", { name: /Approved merchant/ }).click();
    await page.getByRole("option", { name: /Unapproved address/ }).click();
    await expect(panel.getByText("Would go through", { exact: true })).toBeVisible();

    await page.locator('.modern-switch:has(input[aria-label="Require approved merchants"])').click();
    await expect(page.getByLabel("Require approved merchants")).toBeChecked();
    await expect(panel.getByText("Would be blocked", { exact: true })).toBeVisible();
    await expect(panel).toContainText("isn't on the approved list");
  });
});

test.describe("settings: AI usage pricing", () => {
  test("saving sends plain numbers converted to the units the service stores", async ({ page }) => {
    await installGateway(page);
    const saved: Array<Record<string, unknown>> = [];
    await page.route("**/api/v1/tenant/pricing-model", async (route) => {
      if (route.request().method() === "PUT" || route.request().method() === "POST") {
        saved.push(route.request().postDataJSON());
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      }
      return route.fallback();
    });
    await page.goto("/app/settings");
    await page.getByRole("tab", { name: "AI Rate Cards" }).click();

    // The stored 10% discount is shown as 10, not as 1000 basis points.
    await expect(page.getByLabel(/^Discount/)).toHaveValue("10");
    await expect(page.getByText("10% off").first()).toBeVisible();

    await page.getByLabel(/^Discount/).fill("15");
    await page.getByLabel(/^Monthly usage cap/).fill("5");
    await page.getByRole("button", { name: "Save pricing" }).click();

    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]).toMatchObject({ modelType: "flat_discount", discountBps: 1500, tokenCapTokens: 5_000_000 });
    await expect(page.getByText("Pricing model updated successfully.")).toBeVisible();
  });

  test("switching the plan shows only that plan's fields and sends its own values", async ({ page }) => {
    await installGateway(page);
    const saved: Array<Record<string, unknown>> = [];
    await page.route("**/api/v1/tenant/pricing-model", async (route) => {
      if (route.request().method() !== "GET") {
        saved.push(route.request().postDataJSON());
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      }
      return route.fallback();
    });
    await page.goto("/app/settings");
    await page.getByRole("tab", { name: "AI Rate Cards" }).click();
    await expect(page.getByLabel(/^Fee per request/)).toHaveCount(0);

    await page.getByRole("button", { name: /Flat discount/ }).click();
    await page.getByRole("option", { name: /Per-request fee/ }).click();
    await expect(page.getByLabel(/^Discount/)).toHaveCount(0);
    await page.getByLabel(/^Fee per request/).fill("0.002");
    await page.getByRole("button", { name: "Save pricing" }).click();

    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]).toMatchObject({ modelType: "per_unit_request", perCallFeeMicroDollars: 2000 });
  });

  test("the cost estimate sends the entered workload and shows the returned price", async ({ page }) => {
    await installGateway(page);
    const requests: Array<Record<string, unknown>> = [];
    await page.route("**/api/v1/finops/calculate-spend", async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          modelName: "claude-3-7-sonnet",
          totalTokens: 235_000,
          inputTokens: 150_000,
          outputTokens: 25_000,
          cacheReadTokens: 50_000,
          cacheCreationTokens: 10_000,
          nominalListCostMicroDollars: 1_000_000,
          effectiveCostMicroDollars: 900_000,
          effectiveDiscountBps: 1000,
          contractModel: "flat_discount",
          ptuCapacityApplied: 0,
          ptuOverageTokens: 0,
        }),
      });
    });
    await page.goto("/app/settings");
    await page.getByRole("tab", { name: "AI Rate Cards" }).click();
    await page.getByRole("button", { name: "Calculate cost" }).click();

    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toMatchObject({ inputTokens: 150000, outputTokens: 25000, isBatch: false });
    const result = page.getByRole("heading", { name: "Estimated cost" }).locator("..").locator("..");
    await expect(result).toContainText("$1.0000");
    await expect(result).toContainText("$0.9000");
    await expect(result).toContainText("10.0% off");
  });
});

test.describe("test rules: safety lab", () => {
  test("never pauses an agent when the checks themselves could not run", async ({ page }) => {
    await installGateway(page);
    await page.goto("/app/simulator");
    const lab = page.locator(".qwen-circuit-breaker-panel");
    await expect(lab.getByText("Normal", { exact: true })).toBeVisible();

    await lab.getByRole("button", { name: "Simulate a runaway loop" }).click();

    // Three probes, then an honest outcome: unavailable checks are not policy verdicts.
    await expect(lab.getByText("Nothing was changed because some checks were unavailable.")).toBeVisible({ timeout: 10_000 });
    await expect(lab.getByText("Normal", { exact: true })).toBeVisible();
    await expect(lab.getByText("Paused", { exact: true })).toHaveCount(0);
    await expect(lab.getByRole("button", { name: "Simulate a runaway loop" })).toBeEnabled();
  });
});

test.describe("agents: card view shows only real data", () => {
  test("renders roster facts and no invented roles, budgets or capabilities", async ({ page }) => {
    await installGateway(page);
    await page.goto("/app/fleet");
    await page.getByRole("button", { name: "Card view" }).click();

    const grid = page.getByRole("region", { name: "Agent cards" });
    await expect(grid.getByRole("button", { name: "Inspect Research assistant" })).toBeVisible();
    await expect(grid.getByRole("button", { name: "Inspect Invoice bot" })).toBeVisible();
    // Real roster status, not a role-based guess.
    await expect(grid.getByText("Active", { exact: true })).toHaveCount(1);
    await expect(grid.getByText("Isolated", { exact: true })).toHaveCount(1);
    await expect(grid.getByText("Tier 1 · Critical")).toBeVisible();

    // The gateway serves no delegations, budgets or capabilities, so none may appear.
    const text = (await grid.innerText()) + (await page.locator(".agent-card-grid-container").innerText());
    expect(text).not.toMatch(/\$\s?\d/);
    expect(text).not.toMatch(/USDC/);
    for (const invented of ["1000.00", "150.00", "320.00", "48.00", "Supervisor", "Worker", "Specialist", "Sub-Agents", "orchestration:", "inference:", "payment:eip712"]) {
      expect(text).not.toContain(invented);
    }
    await expect(page.getByRole("button", { name: /Delegate Sub-Budget|Create temporary access/ })).toHaveCount(0);
  });

  test("with no agents it shows an empty state with a way to add one", async ({ page }) => {
    await installGateway(page);
    await page.route("**/api/v1/agents", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );
    await page.goto("/app/fleet");
    await page.getByRole("button", { name: "Card view" }).click();

    await expect(page.getByText("No agents to show yet")).toBeVisible();
    await expect(page.getByRole("region", { name: "Agent cards" })).toHaveCount(0);
    await expect(page.getByText(/\$\s?\d/)).toHaveCount(0);
    await page.getByRole("button", { name: "Provision First Agent" }).last().click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});

test.describe("treasury: developer-network faucet", () => {
  test("is offered on the local profile only", async ({ page }) => {
    // The e2e build runs with VITE_APP_ENV=local; the non-local guard is asserted in the source test.
    await installGateway(page);
    await page.goto("/app/treasury");
    await expect(page.getByRole("button", { name: /Devnet Faucet/ })).toBeVisible();
  });
});
