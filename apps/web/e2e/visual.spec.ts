import { installGateway } from "./support/fixtures";
import { expect, test } from "./support/test";

// Pixel comparison of the screens people look at most. Run through `npm run test:visual`, which uses
// the same pinned Playwright image as CI; baselines live in e2e/__screenshots__.
// The clock is frozen at the fixtures' "now" so relative dates, and anything else derived from the
// current time, render identically on every run. Data comes from the same fixtures as the other suites.
const NOW = new Date("2026-10-03T12:00:00.000Z");

const tenantScreens = [
  { name: "overview", path: "/app/overview" },
  { name: "fleet", path: "/app/fleet" },
  { name: "approvals", path: "/app/quorum" },
  { name: "policy", path: "/app/policy" },
  { name: "treasury", path: "/app/treasury" },
];
const adminScreens = [
  { name: "admin-overview", path: "/admin/overview" },
  { name: "admin-tenants", path: "/admin/tenants" },
];

const viewports = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 412, height: 915 },
} as const;

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    for (const screen of [...tenantScreens, ...adminScreens]) {
      test(`${screen.name} (desktop)`, async ({ page }) => {
        await page.clock.install({ time: NOW });
        await installGateway(page);
        await page.setViewportSize(viewports.desktop);
        await page.goto(screen.path);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        await page.evaluate(async () => document.fonts.ready);
        await expect(page).toHaveScreenshot(`${screen.name}-${theme}-desktop.png`, { fullPage: true });
      });
    }
  });
}

test.describe("phone layout", () => {
  for (const screen of [tenantScreens[0], tenantScreens[2]]) {
    test(`${screen.name} (phone, light)`, async ({ page }) => {
      await page.clock.install({ time: NOW });
      await installGateway(page);
      await page.setViewportSize(viewports.phone);
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await page.evaluate(async () => document.fonts.ready);
      await expect(page).toHaveScreenshot(`${screen.name}-light-phone.png`, { fullPage: true });
    });
  }
});
