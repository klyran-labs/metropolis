#!/usr/bin/env node
// Serves the end-to-end build through the real nginx configuration (same config files, same shared
// security snippets, rendered by the same script the production images use) and runs the browser
// suite against it. Any enforced Content-Security-Policy violation fails a test; headers are also
// checked directly. Requires Docker.
//
// The sign-in widget is replaced by a stub in the e2e build, so this verifies our own bundle against
// the policies, not the third-party widget's network behaviour. The staged strict policy therefore
// stays Report-Only until real traffic has been observed.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const web = join(root, "apps/web");
const container = `ag-csp-nginx-${process.pid}`;
const upstreamContainer = `ag-csp-upstream-${process.pid}`;
const network = `ag-csp-net-${process.pid}`;
const snippets = mkdtempSync(join(tmpdir(), "ag-snippets-"));
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: "utf8", ...options });

function cleanup() {
  spawnSync("docker", ["rm", "-f", container, upstreamContainer], { stdio: "ignore" });
  spawnSync("docker", ["network", "rm", network], { stdio: "ignore" });
  rmSync(snippets, { recursive: true, force: true });
}
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));

const e2eEnv = {
  ...process.env,
  VITE_APP_ENV: "local",
  VITE_APP_TARGET: "unified",
  VITE_CHAIN_ID: "10143",
  VITE_RPC_URL: "http://127.0.0.1:8545",
};
console.log("Building the end-to-end bundle…");
run("npx", ["vite", "build", "--config", "vite.e2e.config.ts", "--outDir", "dist-e2e", "--emptyOutDir"], {
  cwd: web,
  env: e2eEnv,
  stdio: "ignore",
});

run("sh", [
  join(root, "docker/nginx/render-snippets.sh"),
  "local",
  e2eEnv.VITE_RPC_URL,
  join(root, "docker/nginx"),
  snippets,
]);

// The admin configuration serves every route, so one server covers tenant and admin screens.
const mounts = [
  "-v", `${join(root, "docker/nginx.admin.conf")}:/etc/nginx/nginx.conf:ro`,
  "-v", `${snippets}:/etc/nginx/snippets:ro`,
  "-v", `${join(web, "dist-e2e")}:/usr/share/nginx/html:ro`,
];
const base = ["--network", network, ...mounts, "nginx:alpine"];

// Every shipped configuration must parse under every CSP profile.
console.log("Validating nginx configuration…");
for (const config of ["nginx.tenant.conf", "nginx.admin.conf"]) {
  for (const profile of ["production", "local"]) {
    const profileDir = mkdtempSync(join(tmpdir(), "ag-profile-"));
    try {
      run("sh", [join(root, "docker/nginx/render-snippets.sh"), profile, "https://rpc.example.com/v1/key", join(root, "docker/nginx"), profileDir]);
      run(
        "docker",
        [
          "run", "--rm", "--add-host", "agentguard-gateway:host-gateway",
          "-v", `${join(root, "docker", config)}:/etc/nginx/nginx.conf:ro`,
          "-v", `${profileDir}:/etc/nginx/snippets:ro`,
          "nginx:alpine", "nginx", "-t",
        ],
        { stdio: "pipe" },
      );
    } catch (error) {
      console.error(`${config} (${profile}) failed validation:\n${error.stderr ?? error.message}`);
      process.exit(1);
    } finally {
      rmSync(profileDir, { recursive: true, force: true });
    }
  }
}

// Stand-in upstream, reachable by nginx as agentguard-gateway:8080 on a private network (so it never
// collides with anything listening on the host). It emits one event immediately and another later.
run("docker", ["network", "create", network]);
const upstreamScript = `
require("node:http").createServer((request, response) => {
  if (/\\/telemetry\\/stream$/.test(request.url)) {
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    response.write("data: first\\n\\n");
    setTimeout(() => response.end("data: second\\n\\n"), 3000);
  } else {
    response.writeHead(204).end();
  }
}).listen(8080);
`;
run("docker", [
  "run", "-d", "--name", upstreamContainer, "--network", network, "--network-alias", "agentguard-gateway",
  "node:24-alpine", "node", "-e", upstreamScript,
]);

run("docker", ["run", "-d", "--name", container, "-p", "127.0.0.1::80", ...base]);
const port = run("docker", ["port", container, "80/tcp"]).trim().split(":").pop();
const baseUrl = `http://127.0.0.1:${port}`;

for (let attempt = 0; ; attempt += 1) {
  try {
    if ((await fetch(`${baseUrl}/`, { redirect: "manual" })).status < 500) break;
  } catch {
    // not accepting connections yet
  }
  if (attempt > 50) throw new Error("nginx did not become ready");
  await new Promise((done) => setTimeout(done, 100));
}

// The stream must deliver events promptly and stay open for later ones. This guards regressions in the
// stream location (for example an added cache, compression or short timeout). It does not prove
// `proxy_buffering off` is required: nginx forwards small events promptly even when buffering is on,
// and the directives themselves are asserted statically in the web unit tests.
console.log("Checking the live-update stream through nginx…");
{
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/v1/telemetry/stream`);
  if (response.status !== 200 || !/text\/event-stream/.test(response.headers.get("content-type") ?? "")) {
    throw new Error(`stream did not return an event stream (status ${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = "";
  let firstAt = 0;
  while (!received.includes("second")) {
    const { value, done } = await reader.read();
    if (done) break;
    received += decoder.decode(value, { stream: true });
    if (!firstAt && received.includes("first")) firstAt = performance.now() - started;
  }
  const total = performance.now() - started;
  if (!received.includes("first") || !received.includes("second")) {
    console.error("The stream did not deliver both events.");
    process.exit(1);
  }
  if (firstAt > 1500) {
    console.error(`First stream event took ${Math.round(firstAt)} ms.`);
    process.exit(1);
  }
  console.log(`  first event ${Math.round(firstAt)} ms, later event after ${Math.round(total)} ms on the same connection`);
}

console.log("Checking response headers…");
const page = await fetch(`${baseUrl}/app/overview`);
const header = (name) => page.headers.get(name) ?? "";
const failures = [];
const expectHeader = (name, pattern) => {
  if (!pattern.test(header(name))) failures.push(`${name}: expected ${pattern}, got "${header(name)}"`);
};
expectHeader("content-security-policy", /script-src 'self';/);
expectHeader("content-security-policy", /object-src 'none'/);
expectHeader("content-security-policy", /frame-ancestors 'none'/);
expectHeader("content-security-policy-report-only", /report-uri \/api\/v1\/telemetry\/csp-report/);
expectHeader("content-security-policy-report-only", /connect-src 'self' http:\/\/127\.0\.0\.1:8545 /);
expectHeader("reporting-endpoints", /csp="\/api\/v1\/telemetry\/csp-report"/);
expectHeader("x-content-type-options", /nosniff/);
expectHeader("x-frame-options", /DENY/);
if (/fonts\.googleapis\.com/.test(header("content-security-policy"))) failures.push("CSP still allows Google Fonts");
const asset = await fetch(`${baseUrl}/assets/${(await page.text()).match(/assets\/([^"]+\.js)/)?.[1]}`);
if (!/script-src 'self';/.test(asset.headers.get("content-security-policy") ?? "")) failures.push("assets lack the CSP header");
if (failures.length) {
  console.error(`Header checks failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(`Running the browser suite against nginx at ${baseUrl}…`);
const result = spawnSync("npx", ["playwright", "test", ...process.argv.slice(2)], {
  cwd: web,
  stdio: "inherit",
  env: { ...process.env, E2E_BASE_URL: baseUrl },
});
process.exit(result.status ?? 1);
