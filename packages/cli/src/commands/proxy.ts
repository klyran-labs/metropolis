import http from "node:http";
import { loadConfig } from "../config.js";

export async function proxyCommand(options: { port?: string; target?: string }): Promise<void> {
  const config = await loadConfig();
  const port = parseInt(options.port || "8080", 10);
  const target = options.target || config.gatewayUrl;
  const apiKey = config.apiKey || process.env.AGENTGUARD_API_KEY;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    const targetUrl = new URL(url.pathname + url.search, target);

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value && typeof value === "string") {
        headers[key] = value;
      }
    }
    if (apiKey && !headers["authorization"]) {
      headers["authorization"] = `Bearer ${apiKey}`;
    }

    const proxyReq = http.request(
      targetUrl,
      {
        method: req.method,
        headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      }
    );

    proxyReq.on("error", (err) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Bad Gateway", message: err.message }));
    });

    req.pipe(proxyReq, { end: true });
  });

  server.listen(port, () => {
    console.log(`AgentGuard drop-in testing proxy active on http://127.0.0.1:${port}`);
    console.log(`Forwarding LLM completions & inference traffic to ${target}`);
  });
}
