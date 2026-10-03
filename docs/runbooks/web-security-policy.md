# Web security policy and browser telemetry

## What ships

Both web images (tenant and admin) serve the same headers from one source, `docker/nginx/security-headers.conf`. nginx drops inherited `add_header` directives in any location that defines its own, so every such location includes that file rather than repeating the list.

| Header | Purpose |
| --- | --- |
| `Content-Security-Policy` (enforced) | Blocks plugins, framing, base-tag injection and any script not served from this origin. |
| `Content-Security-Policy-Report-Only` (staged) | The end-state policy with every source pinned. Violations are reported, never blocked. |
| `Reporting-Endpoints` | Tells the browser where `report-to csp` reports go. |
| Frame, MIME, referrer, permissions, cross-origin headers | Baseline hardening. |

The enforced policy keeps `style-src 'unsafe-inline'` (the sign-in widget injects `<style>` elements) and `https:` for images, fonts and connections (the widget's endpoints are not pinned yet). The staged policy removes both and lists the Monad RPC origin, Privy and WalletConnect explicitly.

## Profiles

`CSP_PROFILE` is a build argument of `Dockerfile.web` and `Dockerfile.admin`:

* `production` (default): used by testnet and mainnet images. No loopback origins.
* `local`: adds loopback origins for the developer stack. Only `docker-compose.yml` sets it; a unit test fails if the testnet or mainnet compose files do.

`docker/nginx/render-snippets.sh` renders the profile and substitutes the RPC origin from `VITE_RPC_URL`. The Dockerfiles and the verification harness call the same script.

## Promoting the staged policy

1. Deploy and let real sessions run through at least one release cycle.
2. Search gateway logs for target `csp`. Each record has the page path, violated directive, blocked origin (never a full URL) and disposition.
3. Group by `directive` and `blocked`. Anything that is a legitimate dependency of the sign-in widget or wallet connection: add its origin to the staged policy in `csp.production.conf` and redeploy. Anything unexpected: investigate before allowing.
4. When a full cycle shows no unexplained reports, copy the staged policy into the enforced header (keep `report-uri` on it) and remove the report-only header.

The end-to-end suite already runs clean against the staged policy for our own bundle, so reports after deploy come from third-party widgets or browser extensions, not from application code.

## Verifying

```bash
npm run test:csp
```

Builds the end-to-end bundle, validates both nginx configurations under both profiles, serves the bundle through the real configuration in Docker, checks response headers, streams from a stand-in upstream, and runs the whole browser suite against it. Any Content-Security-Policy violation (enforced or staged) fails the test that caused it. The sign-in widget is stubbed in that build, so the run verifies our own code against the policies; it cannot verify the widget's real network behaviour, which is why the strict policy is not enforced yet.

The stream check confirms events arrive promptly and the connection stays open. It does not prove `proxy_buffering off` is required (nginx forwards small events promptly either way); the directive is asserted statically in the web unit tests.

## Browser telemetry

The app reports Core Web Vitals (LCP, CLS, INP, FCP, TTFB) and up to five sanitized client errors per page view to `POST /api/v1/telemetry/web-vitals` when the page is hidden or closed. Pages are reported as paths without query strings; error text has URL query parts, long hex identifiers and credential-like pairs removed before it leaves the browser, and the gateway sanitizes again. Search gateway logs by target `web_vitals` and `web_errors`. Limits and abuse controls are described in the gateway operations runbook.

Fonts are self-hosted (Inter and JetBrains Mono, Latin and Latin Extended subsets), so no third-party font host is contacted.
