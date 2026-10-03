import AxeBuilder from "@axe-core/playwright";
import { createServer, type ServerResponse } from "node:http";
import { expect, test } from "./support/test";
import { defaultScenario, installGateway, manyPending } from "./support/fixtures";

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

test.describe("approvals paging", () => {
  test("loads more transfers on demand and keeps the badge on the org-wide total", async ({ page }, testInfo) => {
    const scenario = defaultScenario();
    scenario.pending = manyPending(30);
    await installGateway(page, scenario);
    await page.goto("/app/quorum");

    await expect(page.getByRole("heading", { level: 1, name: "Approvals" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(25);
    // The badge counts everything the operator can sign, not just the first page.
    if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("link", { name: /Approvals/ }).locator(".sidebar-link-count")).toHaveText("30");
    if (testInfo.project.name === "mobile") await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Show more (5 left)" }).click();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(30);
    await expect(page.getByRole("button", { name: /Show more/ })).toHaveCount(0);
  });
});

test.describe("push updates", () => {
  test("a pushed event refreshes the badge without waiting for a poll", async ({ page }, testInfo) => {
    // A real SSE endpoint that the test can push to.
    const clients = new Set<ServerResponse>();
    const server = createServer((request, response) => {
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Headers", "authorization, accept");
      if (request.method === "OPTIONS") {
        response.writeHead(204).end();
        return;
      }
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      response.write(": connected\n\n");
      clients.add(response);
      request.on("close", () => clients.delete(response));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    const push = (event: string) => clients.forEach((client) => client.write(`event: ${event}\ndata: {}\n\n`));

    try {
      const scenario = defaultScenario();
      await installGateway(page, scenario, { streamUrl: `http://127.0.0.1:${port}/stream` });
      await page.goto("/app/overview");
      if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "Open menu" }).click();
      const badge = page.getByRole("link", { name: /Approvals/ }).locator(".sidebar-link-count");
      await expect(badge).toHaveText("1");
      await expect.poll(() => clients.size, { message: "client connected to the stream" }).toBeGreaterThan(0);

      // Another operator creates a transfer that needs this operator's signature.
      scenario.pending = [...scenario.pending, { ...scenario.pending[0], transferId: "88888888-8888-7888-8888-888888888888" }];
      push("approvals_changed");

      // The poll interval is 20s (60s while connected); this must arrive far sooner.
      await expect(badge).toHaveText("2", { timeout: 4000 });
    } finally {
      clients.forEach((client) => client.end());
      server.close();
    }
  });

  test("without a push channel the UI still loads (polling fallback)", async ({ page }) => {
    await installGateway(page); // stream aborted
    await page.goto("/app/overview");
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Needs your attention" })).toContainText("1 transfer needs your approval");
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

test.describe("performance reporting", () => {
  test("sends page metrics and a scrubbed error when the page is hidden", async ({ page }) => {
    await installGateway(page);
    const reports: Array<{ page: string; metrics: Array<{ name: string }>; errors: Array<{ message: string }> }> = [];
    await page.route("**/api/v1/telemetry/web-vitals", async (route) => {
      reports.push(route.request().postDataJSON());
      await route.fulfill({ status: 204 });
    });
    await page.goto("/app/overview?session=secret-value");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

    await page.evaluate(() => {
      window.dispatchEvent(
        new ErrorEvent("error", { message: "boom at https://example.com/x?token=abc and 0xA978BD5ea722e96caFe47384877F39f8E7EAD22f" }),
      );
      window.dispatchEvent(new Event("pagehide"));
    });

    await expect.poll(() => reports.length).toBeGreaterThan(0);
    const report = reports[0];
    expect(report.metrics.map((metric) => metric.name)).toEqual(expect.arrayContaining(["TTFB", "FCP"]));
    expect(report.page).toBe("/app/overview");
    expect(JSON.stringify(report)).not.toContain("secret-value");
    expect(report.errors[0].message).toBe("boom at https://example.com/x and 0x…");
  });
});

test.describe("typography", () => {
  test("loads the self-hosted typeface and never contacts a third-party font host", async ({ page }) => {
    await installGateway(page);
    const external: string[] = [];
    page.on("request", (request) => {
      const { hostname } = new URL(request.url());
      if (!["127.0.0.1", "localhost"].includes(hostname)) external.push(request.url());
    });
    await page.goto("/app/overview");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    // `fonts.check` is true when no face matches at all, so inspect the faces themselves.
    const loadedFaces = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].filter((face) => face.family.includes("Inter Variable") && face.status === "loaded").length;
    });
    expect(loadedFaces).toBeGreaterThan(0);
    expect(external).toEqual([]);
  });
});

test.describe("theme", () => {
  test("switching theme changes the palette and releases the transition lock", async ({ page }) => {
    await installGateway(page);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/app/overview");
    const root = page.locator("html");
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const before = await background();

    const toggle = page.getByRole("button", { name: "Switch to dark mode" });
    if (!(await toggle.isVisible())) await page.getByRole("button", { name: "Account menu" }).click();
    await toggle.click();

    await expect(root).toHaveAttribute("data-theme", "dark");
    await expect(root).not.toHaveAttribute("data-theme-switching", "");
    expect(await background()).not.toBe(before);
  });
});

test.describe("small screens", () => {
  const screens = [
    "/app/overview", "/app/fleet", "/app/quorum", "/app/policy", "/app/treasury", "/app/billing", "/app/settings",
    "/app/activity", "/app/simulator", "/app/merchants",
    "/admin/overview", "/admin/tenants", "/admin/plans", "/admin/subscriptions", "/admin/billing",
    "/admin/reconciliation", "/admin/revenue", "/admin/access",
  ];

  for (const path of screens) {
    test(`${path} fits the screen width`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "checked at phone width");
      await installGateway(page);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      // Anything wider than the screen must live inside its own horizontal scroller (for example a table).
      // The page's main area does not count as one: scrolling the whole page sideways is the bug.
      const escaping = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const main = document.querySelector("main.content");
        const scrolls = (element: Element | null) => {
          for (let node = element; node && node !== main && node !== document.body; node = node.parentElement) {
            const overflow = getComputedStyle(node).overflowX;
            if (overflow === "auto" || overflow === "scroll") return true;
          }
          return false;
        };
        return Array.from(document.querySelectorAll("body *"))
          .filter((element) => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && box.right > width + 1 && !scrolls(element.parentElement) && !scrolls(element);
          })
          .slice(0, 5)
          .map((element) => `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]}`);
      });
      expect(escaping, "elements wider than the screen").toEqual([]);
    });
  }
});
