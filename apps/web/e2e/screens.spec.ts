import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test";
import { installGateway } from "./support/fixtures";

const SCREENS: Array<{ path: string; heading: string }> = [
  { path: "/app/overview", heading: "Home" },
  { path: "/app/fleet", heading: "Agents" },
  { path: "/app/policy", heading: "Spending rules" },
  { path: "/app/simulator", heading: "Test rules" },
  { path: "/app/activity", heading: "Activity" },
  { path: "/app/merchants", heading: "Merchants" },
  { path: "/app/quorum", heading: "Approvals" },
  { path: "/app/treasury", heading: "Treasury" },
  { path: "/app/billing", heading: "Billing & Subscription" },
  { path: "/app/settings", heading: "Settings" },
  { path: "/admin/overview", heading: "Home" },
  { path: "/admin/tenants", heading: "Organizations" },
  { path: "/admin/plans", heading: "Plans" },
  { path: "/admin/subscriptions", heading: "Subscriptions" },
  { path: "/admin/billing", heading: "Payments" },
  { path: "/admin/reconciliation", heading: "Payment checks" },
  { path: "/admin/revenue", heading: "Revenue" },
  { path: "/admin/access", heading: "Team" },
];

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem("agentguard-theme", value), theme);
      await installGateway(page);
    });

    for (const screen of SCREENS) {
      test(`${screen.path} renders cleanly and is accessible`, async ({ page }, testInfo) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));

        await page.goto(screen.path);
        await expect(page.getByRole("heading", { level: 1, name: screen.heading })).toBeVisible();

        // No horizontal scroll at any width.
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, "page should not scroll horizontally").toBeLessThanOrEqual(1);

        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        const blocking = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
        expect(
          blocking.map((violation) => `${violation.id} (${violation.nodes.length}): ${violation.help}`),
          "serious or critical accessibility violations",
        ).toEqual([]);

        await testInfo.attach(`${theme}-${screen.path.replace(/\//g, "_")}.png`, {
          body: await page.screenshot({ fullPage: false }),
          contentType: "image/png",
        });
        expect(pageErrors).toEqual([]);
      });
    }
  });
}
