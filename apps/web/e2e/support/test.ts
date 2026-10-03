import { test as base, expect } from "@playwright/test";

type Violation = { directive: string; blocked: string; disposition: string; source: string };

// Records every Content-Security-Policy violation the page reports and fails the test on any of them,
// enforced or report-only. The report-only policy is the staged strict one: keeping our own bundle
// clean against it is what makes promoting it to enforced safe. Without a CSP header (plain
// `vite preview`) no events fire and this is a no-op.
export const test = base.extend<{ cspGuard: void }>({
  cspGuard: [
    async ({ page }, use) => {
      await page.addInitScript(() => {
        const w = window as unknown as { __cspViolations: Violation[] };
        w.__cspViolations = [];
        document.addEventListener("securitypolicyviolation", (event) => {
          w.__cspViolations.push({
            directive: event.effectiveDirective,
            blocked: event.blockedURI,
            disposition: event.disposition,
            source: event.sourceFile ? `${event.sourceFile}:${event.lineNumber}` : "",
          });
        });
      });
      await use();
      const violations = await page
        .evaluate(() => (window as unknown as { __cspViolations?: Violation[] }).__cspViolations ?? [])
        .catch(() => [] as Violation[]);
      expect(violations, "Content-Security-Policy violations (enforced or staged strict policy)").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
