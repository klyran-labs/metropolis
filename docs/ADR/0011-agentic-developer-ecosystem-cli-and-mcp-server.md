# ADR 0011: Agentic Developer Ecosystem, CLI & Model Context Protocol (MCP) Architecture

## Status
**Implemented** (Supersedes Hackathon Phase 3 target — fully deployed)

## Context
For AgentGuard to achieve widespread adoption across autonomous agent teams, it must integrate frictionlessly into developers' existing toolchains:
1. **Agent Frameworks**: Teams build agents using LangChain, CrewAI, AutoGen, ElizaOS, and direct OpenAI/Anthropic Python/TypeScript SDKs. Requiring developers to rewrite their application code or adopt proprietary SDKs creates high friction.
2. **Terminal & DevOps Pipelines**: Cloud engineers deploying agents in CI/CD, Kubernetes, and Docker require command-line automation for provisioning, key rotation, and emergency containment.
3. **Emerging AI Protocols (MCP)**: Anthropic's Model Context Protocol (MCP) has emerged as the standard protocol for AI clients (Claude Desktop, Cursor, Goose) to discover and invoke external tools.

## Decision

We implement a three-tier **Agentic Developer Ecosystem** that allows autonomous agents and human developers to interact with AgentGuard natively:

### 1. The 1-Line Drop-in SDK Proxy
The AgentGuard Gateway implements drop-in reverse proxy routing compatible with standard OpenAI and Anthropic client libraries:

```python
from anthropic import Anthropic

# Single line modification: change base_url and use AgentGuard machine key
client = Anthropic(
    base_url="https://gateway.agentguard.io/v1/anthropic",
    api_key=os.environ["AGENTGUARD_API_KEY"],  # Headless Service Account Key
)

response = client.messages.create(
    model="claude-3-7-sonnet",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Execute scheduled market analysis"}]
)
```
* The gateway intercepts the request, evaluates the agent's Monad policy in sub-millisecond execution, injects the encrypted BYOK/Master key, and streams the completion back.

### 2. The AgentGuard CLI (`packages/cli` -> `circuit` / `agentguard`)
A lightweight, fast Node.js command-line interface for terminal and CI/CD operations:
* `circuit login`: Authenticates the developer or service account.
* `circuit agents list`: Displays registered agents, active policies, and window spend.
* `circuit agents register --name <name> --tokens <cap> --window <duration>`: Provisions new agent.
* `circuit agents freeze <address>`: Emergency $O(1)$ kill-switch execution.
* `circuit proxy --port 8080`: Local zero-configuration testing proxy.
* `circuit finops calculate`: Dual-denomination rate card simulator (MON + USDC).
* `circuit mcp init [--client cursor|claude|goose] [--dry-run]`: Generates MCP configuration for AI clients (Claude Desktop, Cursor, Goose). Outputs ready-to-paste JSON configuration. Supports `--dry-run` for preview without writing to disk.

### 3. Official Model Context Protocol (MCP) Server (`@agentguard/mcp-server`)
We implement a native MCP server conforming to the Model Context Protocol specification over stdio and SSE transport, exposing **5 standardized tools** directly to AI reasoning loops:

#### Core Budget & Policy Tools (3)
```json
{
  "tools": [
    {
      "name": "agentguard_check_budget",
      "description": "Inspects remaining token and financial budget for the current agent session before initiating high-compute tasks.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "agentAddress": { "type": "string", "description": "0x address of the agent" }
        },
        "required": ["agentAddress"]
      }
    },
    {
      "name": "agentguard_inspect_limits",
      "description": "Returns live velocity rate limit, sliding window duration, and circuit breaker state from the gateway policy endpoint.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "agentAddress": { "type": "string", "description": "0x address of the agent" }
        },
        "required": ["agentAddress"]
      }
    },
    {
      "name": "agentguard_request_spend_elevation",
      "description": "Submits a signed request to human supervisors or treasury managers for temporary budget elevation. Routes to institutional 2-of-3 multisig approval channel.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "requestedAmount": { "type": "string", "description": "Requested additional budget in MON or Tokens" },
          "justification": { "type": "string", "description": "Reason why task requires elevated quota" }
        },
        "required": ["requestedAmount", "justification"]
      }
    }
  ]
}
```

#### Circuit Protocol Supervisory Tools (2) — Added per ADR-0012 Circuit Rebrand
```json
{
  "tools": [
    {
      "name": "circuit_trip_emergency_breaker",
      "description": "Trips the onchain emergency circuit breaker for a rogue or misbehaving agent, halting all spend and Paymaster sponsorship in O(1) time. Issues a real kill-switch POST to the gateway which settles on Monad in ≤400ms.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "agentAddress": { "type": "string", "description": "0x address of the agent" },
          "reason": { "type": "string", "description": "Security incident or anomalous behavior rationale" }
        },
        "required": ["agentAddress", "reason"]
      }
    },
    {
      "name": "circuit_inspect_tba_passport",
      "description": "Inspects the ERC-6551 Token Bound Account (TBA) passport metadata, live TBA address, and EWMA trust reputation score for an agent from the gateway reputation endpoint.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "agentAddress": { "type": "string", "description": "0x address of the agent" }
        },
        "required": ["agentAddress"]
      }
    }
  ]
}
```

**Implementation Notes**:
- All 5 tools make live gateway calls. No hardcoded fallback values.
- Reputation tiers are derived from live EWMA trust scores: Trusted (≥800), Provisional (≥600), Scrutinized (≥400), Flagged (<400).
- `circuit_inspect_tba_passport` and `agentguard_inspect_limits` gracefully degrade to offline sentinel states when the gateway is unreachable.

## Consequences

### Positive
- **Zero Rewrite for Developers**: Existing agent code changes only `base_url` to inherit full Monad spend protection and kill-switches.
- **Native Self-Awareness for Agents via MCP**: Claude Desktop and autonomous reasoning agents can check their own remaining budgets before launching expensive tool calls.
- **DevOps Automations**: CLI allows CI/CD pipelines to provision and decommission agents programmatically.
- **1-Command MCP Onboarding**: `circuit mcp init` generates ready-to-paste Claude Desktop / Cursor config files in seconds.

### Negative / Trade-offs
- Maintaining proxy schema compatibility with rapid upstream changes from OpenAI and Anthropic requires continuous integration testing.

### Architectural Alignment (ADR-0012 & ADR-0013)
* CLI commands (`circuit agents freeze`) map directly to `tripCircuitBreaker(agent)` in **ADR 0012**.
* The MCP tool `circuit_trip_emergency_breaker` mirrors the `tripCircuitBreaker` onchain function — both resolve on Monad in ≤400ms.
* The MCP tool `agentguard_check_budget` queries active epoch allocations (`agentEpochAllocation`) directly from `CircuitVault.sol` (**ADR 0013**), giving autonomous reasoning loops direct visibility into their onchain financial limits.
* The `circuit_inspect_tba_passport` tool surfaces ERC-6551 TBA data per **ADR 0007**.


