import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { defaultScenario, installGateway } from "./support/fixtures";

test.describe("navigation shell", () => {
  test("groups destinations and marks the current page", async ({ page }) => {
    await installGateway(page);
    await page.goto("/app/policy");
    const nav = page.getByRole("navigation", { name: "Workspace" });
    for (const group of ["Agents", "Spending", "Money", "Insights"]) {
      await expect(page.locator(".sidebar-group-label", { hasText: group })).toBeAttached();
    }
    await expect(nav.getByRole("link", { name: "Spending rules" })).toHaveAttribute("aria-current", "page");
  });

  test("collapses to icons and remembers the choice", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "collapse is a desktop control");
    await installGateway(page);
    await page.goto("/app/overview");
    await page.getByRole("button", { name: "Collapse menu" }).click();
    await expect(page.locator(".sidebar")).toHaveClass(/is-collapsed/);
    await page.reload();
    await expect(page.locator(".sidebar")).toHaveClass(/is-collapsed/);
  });

  test("opens as a drawer on small screens and closes with Escape", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "drawer is the mobile layout");
    await installGateway(page);
    await page.goto("/app/overview");
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.locator(".sidebar")).toHaveClass(/is-open/);
    await page.keyboard.press("Escape");
    await expect(page.locator(".sidebar")).not.toHaveClass(/is-open/);
  });

  test("hides destinations a role cannot use", async ({ page }) => {
    const scenario = defaultScenario();
    scenario.role = "fleet_devops";
    await installGateway(page, scenario);
    await page.goto("/app/overview");
    const nav = page.getByRole("navigation", { name: "Workspace" });
    await expect(nav.getByRole("link", { name: "Agents" })).toBeVisible();
    for (const hidden of ["Billing", "Approvals", "Treasury"]) {
      await expect(nav.getByRole("link", { name: new RegExp(`^${hidden}`) })).toHaveCount(0);
    }
  });
});

test.describe("approvals", () => {
  test("badge, attention card and approve flow use the pending list", async ({ page }, testInfo) => {
    await installGateway(page);
    await page.goto("/app/overview");

    // Only the transfer this operator can sign counts toward the badge.
    await expect(page.getByRole("link", { name: /Approvals/ }).locator(".sidebar-link-count")).toHaveText("1");
    await expect(page.getByRole("region", { name: "Needs your attention" })).toContainText("1 transfer needs your approval");
    await expect(page.getByRole("region", { name: "Needs your attention" })).toContainText("1 agent is paused");

    if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("link", { name: /Approvals/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Approvals" })).toBeVisible();
    const buttons = page.getByRole("button", { name: "Approve" });
    await expect(buttons).toHaveCount(2);
    await expect(buttons.nth(0)).toBeEnabled();
    await expect(buttons.nth(1)).toBeDisabled();
    await expect(page.getByText("You've already signed this one")).toBeVisible();

    await buttons.nth(0).click();
    await expect(page.getByText("Approved.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Approvals/ }).locator(".sidebar-link-count")).toHaveCount(0);
  });
});

test.describe("keyboard accessibility", () => {
  test("settings tabs support arrow keys, Home and End", async ({ page }) => {
    await installGateway(page);
    await page.goto("/app/settings");
    const tabs = page.getByRole("tab");
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Credentials" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "AI Rate Cards" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(page.getByRole("tab", { name: "Team" })).toHaveAttribute("aria-selected", "true");
    // Only the active tab is in the tab order, and it points at a real panel.
    await expect(page.getByRole("tab", { name: "Credentials" })).toHaveAttribute("tabindex", "-1");
    await expect(page.getByRole("tabpanel")).toBeVisible();
  });
});

test.describe("honest data", () => {
  test("treasury shows no yield claims and merchants start empty", async ({ page }) => {
    await installGateway(page);
    await page.goto("/app/treasury");
    await expect(page.getByRole("heading", { level: 1, name: "Treasury" })).toBeVisible();
    await expect(page.getByText(/APY|yield/i)).toHaveCount(0);

    await page.goto("/app/merchants");
    await expect(page.getByText("No merchants yet")).toBeVisible();
  });

  test("agent security tab says 'Not yet scored' instead of inventing a score", async ({ page }) => {
    await installGateway(page);
    await page.goto("/app/overview");
    await page.getByRole("row", { name: /0x1111/ }).click();
    await page.getByRole("tab", { name: "Security" }).click();
    await expect(page.getByText("Not yet scored")).toBeVisible();
  });
});

test.describe("overlays are accessible", () => {
  const blocking = (violations: Array<{ id: string; impact?: string | null; nodes: unknown[] }>) =>
    violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.nodes.length})`);

  test("agent inspector drawer, every tab", async ({ page }) => {
    await installGateway(page);
    await page.goto("/app/overview");
    await page.getByRole("row", { name: /0x1111/ }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    for (const tab of ["Overview", "Wallet", "Security", "Health", "Integrate"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tabpanel")).toBeVisible();
      const results = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(blocking(results.violations), `${tab} tab`).toEqual([]);
    }
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });

  test("new credential dialog", async ({ page }) => {
    await installGateway(page);
    await page.goto("/app/settings");
    await page.getByRole("tab", { name: "Credentials" }).click();
    await page.getByRole("button", { name: "New credential" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS("opacity", "1"); // let the open animation finish before measuring contrast
    const results = await new AxeBuilder({ page }).include("dialog").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(blocking(results.violations)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
