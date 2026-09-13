# ADR 0011: Agentic Developer Ecosystem, CLI & Model Context Protocol (MCP) Architecture

## Status
Accepted (Target: Hackathon Phase 3 Integration)

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

### 2. The AgentGuard CLI (`packages/cli` -> `agentguard`)
A lightweight, fast Node.js/Rust command-line interface for terminal and CI/CD operations:
* `agentguard login`: Authenticates the developer or service account.
* `agentguard agents list`: Displays registered agents, active policies, and window spend.
* `agentguard agents register --name <name> --tokens <cap> --window <duration>`: Provisions new agent.
* `agentguard agents freeze <address>`: Emergency $O(1)$ kill-switch execution.
* `agentguard proxy --port 8080`: Local zero-configuration testing proxy.

### 3. Official Model Context Protocol (MCP) Server (`@agentguard/mcp-server`)
We implement a native MCP server conforming to the Model Context Protocol specification over stdio and SSE transport, exposing 3 standardized tools directly to AI reasoning loops:

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
      "description": "Returns current velocity rate limit, sliding window reset timestamp, and active kill-switch status.",
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
      "description": "Submits a signed request to human supervisors or treasury managers for temporary budget elevation.",
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

## Consequences

### Positive
- **Zero Rewrite for Developers**: Existing agent code changes only `base_url` to inherit full Monad spend protection and kill-switches.
- **Native Self-Awareness for Agents via MCP**: Claude Desktop and autonomous reasoning agents can check their own remaining budgets before launching expensive tool calls.
- **DevOps Automations**: CLI allows CI/CD pipelines to provision and decommission agents programmatically.

### Negative / Trade-offs
- Maintaining proxy schema compatibility with rapid upstream changes from OpenAI and Anthropic requires continuous integration testing.

### Architectural Alignment (ADR-0012 & ADR-0013)
* CLI commands (`agentguard agents freeze`) map directly to `tripCircuitBreaker(agent)` in **ADR 0012**.
* The MCP server tool `agentguard_check_budget` queries active epoch allocations (`agentEpochAllocation`) directly from `CircuitVault.sol` (**ADR 0013**), giving autonomous reasoning loops direct visibility into their onchain financial limits.
