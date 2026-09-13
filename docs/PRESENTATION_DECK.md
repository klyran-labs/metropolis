# AgentGuard: Master Hackathon & Investor Presentation Deck (10 Slides)

> **Track:** Trust, Identity & AI Infrastructure  
> **Blockchain:** Monad Parallel EVM (Chain ID 10143)  
> **Pitch Thesis:** The Programmable Risk, Spend Governance & Micro-Settlement Layer for the Autonomous Agent Economy.

---

## Slide 1: The Multi-Billion Dollar Blind Spot

### Headline
**Autonomous Agents Are Spending Real Money. No One Has the Brakes.**

### Visual
* Split graphic: On the left, an autonomous research bot transacting independently; on the right, an enterprise credit card statement showing a **\$14,200 sudden charge** caused by a 3:00 AM recursive prompt loop.

### Voiceover / Pitch Notes
> *"By 2027, over 100 million autonomous agents will be negotiating APIs, procuring cloud compute, and settling payments without humans in the loop. But enterprise CFOs and developers are terrified of deploying them. Why? Because a single prompt injection or recursion bug can drain an entire corporate credit card or onchain treasury in minutes. Today, once an agent is running, you have zero real-time spend control."*

---

## Slide 2: The Broken Status Quo (The Uncanny Valley)

### Headline
**Web2 AI Proxies Can't Settle. Web3 Wallets Are Too Slow & Dangerous.**

### Visual
* The Comparison Spectrum:
  * **Web2 Proxies (Portkey, LiteLLM)**: Centralized Redis DBs, no money settlement, 5–15% token markups, vulnerable to central outages.
  * **Web3 Wallets (Coinbase AgentKit, Gnosis Safe)**: 12-second block times, \$0.02–\$2.00 gas per check, all-or-nothing key custody, completely blind to AI tokens.

### Voiceover / Pitch Notes
> *"Web2 AI gateways like LiteLLM track rate limits in centralized Redis databases, but they cannot move money or settle agent-to-agent transactions. Conversely, Web3 wallets like Coinbase AgentKit give bots private keys, but Ethereum and L2s take seconds to settle, cost dollars per check, and suffer from the all-or-nothing custody trap. If a bot gets hacked, the entire wallet is drained."*

---

## Slide 3: The Breakthrough: AgentGuard on Monad

### Headline
**Sub-Second Cryptographic Spend Guardrails Built for Parallel EVM.**

### Visual
* Architecture Flow:
  `Agent Intent (EIP-712)` $\rightarrow$ `AgentGuard Gateway (<50µs)` $\rightarrow$ `Monad PolicyEngine (<1ms)` $\rightarrow$ `Provider Dispatch (Anthropic/OpenAI)`.
* Highlight: **Disjoint 32-Byte Packed Storage Word** per agent.

### Voiceover / Pitch Notes
> *"AgentGuard bridges this chasm natively on Monad. We have built an onchain spend governance and micro-settlement layer. By packing an agent's entire policy and runtime spend state into a single 32-byte storage slot, thousands of concurrent agents can evaluate policies in parallel with ZERO lock collisions and sub-second 400ms finality."*

---

## Slide 4: Radical Cost Superiority: The Math of Micro-Cent Governance

### Headline
**100x to 600x Cheaper than L2s. Zero Token Markup.**

### Visual
* Cost per 100,000 Agent Requests Comparison Bar Chart:
  * **Base / Arbitrum L2**: \$1,000 – \$3,000 (Gas kills micro-transactions)
  * **Web2 Proxies**: \$50 – \$150+ (Platform fees + 5-15% token surcharges)
  * **AgentGuard on Monad**: **<\$5.00 Total** (~\$0.00005 per onchain commit)

### The Mathematical Derivation
$$\text{Onchain Cost} = 40,000\text{ gas} \times 50\text{ gwei} \times 10^{-9} \times \$25\text{ MON} = \mathbf{\$0.00005\text{ / transaction}}$$
* **Pre-Flight Limit Evaluation (`eth_call`)**: **\$0.000000 (100% Free)**
* **Cancun Transient Reentrancy (`tstore`)**: **100 gas vs 20,000 gas legacy (99.5% savings)**

### Voiceover / Pitch Notes
> *"Running onchain risk checks on traditional L2s costs 2 cents per call—meaning 100,000 agent requests burns \$2,000 in gas just to protect \$50 of AI inference! On Monad, AgentGuard costs \$0.00005 per commit. Pre-flight checks via local RPC cost exactly zero dollars. We deliver institutional onchain immutability at Web2 micro-cent economics."*

---

## Slide 5: The FinOps ROI Equation: Negative Net Cost

### Headline
**AgentGuard Doesn't Cost Money. It Saves Fortunes.**

### Visual
* ROI Graphic:
  * Annual Platform Cost: ~$250/yr
  * Cost of 1 Prevented Prompt Injection Loop: **\$5,000 to \$15,000 saved**
  * **Net Annual ROI: +4,900%**

### Voiceover / Pitch Notes
> *"In enterprise FinOps, the calculation is simple: Platform Cost minus Losses Prevented. When an autonomous web scraper or reasoning bot gets stuck in an infinite retry loop at 2:00 AM, AgentGuard trips the velocity cap on request #11. It drops the request pre-flight with ERR_VELOCITY_EXCEEDED before Anthropic generates a single token. A single prevented runaway loop pays for AgentGuard for three years."*

---

## Slide 6: Comprehensive Pricing & Dual-Denomination Engine

### Headline
**Tokens for Developers. Dollars for CFOs. Any Enterprise Contract.**

### Visual
* Matrix showing:
  1. **Dual-Denomination**: Token Quotas (5M tokens/week) + Financial Caps (\$50/week).
  2. **Flat Custom Discounts**: 25% contracted rate card overrides.
  3. **Tiered Volume Ladders**: Automatic rate step-downs as monthly org volume crosses 100M/500M tokens.
  4. **Committed-Use (CUDs / PTUs)**: Capacity quota firewalls preventing on-demand overages.

### Voiceover / Pitch Notes
> *"We support how enterprises actually buy AI. Developers think in raw token quotas—which are 100% contract-invariant. CFOs think in dollar liability. AgentGuard bridges both, neutralizing the 5x input/output price spread and supporting negotiated rate cards, tiered volume brackets, and AWS/Azure Provisioned Throughput commitments."*

---

## Slide 7: The Cryptographic Air Gap & Sealed Key Enclave

### Headline
**Agents Never See the Master API Keys. Zero Prompt-Injection Risk.**

### Visual
* Security Diagram:
  * Human Admin $\rightarrow$ Privy Web3 Controller (`0xAdmin`)
  * Agent Code $\rightarrow$ Isolated EIP-712 Signer in AES-256-GCM Enclave (`services/opensigner`)
  * Gateway $\rightarrow$ Unlocks upstream API key *only* upon verified Monad policy clearance.

### Voiceover / Pitch Notes
> *"How do we prevent an agent from leaking your API key? We separate the Human Controller from the Autonomous Agent Signer. The bot only holds an EIP-712 signing key sealed in a local hardware enclave. The bot never sees the master Anthropic key. It signs a spend intent; our Gateway evaluates Monad in sub-400ms, and only injects the provider key if the transaction complies with policy."*

---

## Slide 8: Developer Experience: 1 Line of Code, CLI & Native MCP

### Headline
**Zero Code Rewrites. Native Anthropic Model Context Protocol.**

### Visual
* Code snippet side-by-side:
  ```python
  # Standard Anthropic SDK - exactly 1 line changed
  client = Anthropic(
      base_url="https://gateway.agentguard.io/v1/anthropic",
      api_key=os.environ["AGENTGUARD_API_KEY"],
  )
  ```
* Icons: `agentguard` CLI, Anthropic MCP Server (`check_budget`, `inspect_limits`).

### Voiceover / Pitch Notes
> *"Developers do not want to rewrite their agent logic. With AgentGuard, integration is literally one line of code: change base_url to the AgentGuard Gateway. For autonomous Claude Desktop and Cursor workflows, our official MCP Server gives agents native tools to inspect their own remaining budgets before initiating expensive reasoning tasks."*

---

## Slide 9: The Autonomous Agent Economy: HTTP 402 (x402)

### Headline
**From Web2 API Proxy to Agent-to-Agent Micro-Settlement.**

### Visual
* Transaction Flow:
  Agent A (Data Analyst) $\xrightarrow{\text{GET /data}}$ Agent B (Firecrawl Scraper)  
  Agent B $\xrightarrow{\text{HTTP 402 Challenge}}$ Agent A  
  Agent A $\xrightarrow{\text{Signed EIP-712 Payment}}$ Gateway $\rightarrow$ **Monad Testnet 400ms Settlement**.

### Voiceover / Pitch Notes
> *"Beyond centralized SaaS, AgentGuard is the clearinghouse for the agentic economy. Through native HTTP 402 Payment Required negotiation, Agent A can buy data from Agent B and settle in MON or USDC in 400ms without credit cards, human approval, or banking rails. It is permissionless commerce, bounded by onchain economic safety."*

---

## Slide 10: The Vision & Hackathon Roadmap

### Headline
**The Economic Operating System for Autonomous Agents on Monad.**

### Key Milestones
* **Phase 1 (Done)**: 51/51 deterministic tests passing, Cancun `tstore` reentrancy guard, disjoint slot packing.
* **Phase 2 (Sep 21-28)**: Live Monad Testnet (10143) deployment, Privy \$5k Bounty integration, Envio HyperSync.
* **Phase 3 (Sep 29-Oct 6)**: 1-Line SDK Plugin, CLI, and `@agentguard/mcp-server`.
* **Phase 4 (Oct 7-14)**: Production Media, Live Demo, and Hackathon Submission.

### Closing Call to Action
> *"Autonomous agents are already executing code. Tomorrow, they will execute the global economy. AgentGuard ensures that when they do, your treasury and credit card are mathematically safe. Built for developers, trusted by enterprises, powered exclusively by Monad."*
