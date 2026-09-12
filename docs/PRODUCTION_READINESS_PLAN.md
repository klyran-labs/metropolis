# ComputeX Production Readiness & Global Product Plan

**Review posture:** Principal Web3 fintech and DePIN systems architecture review, using Google-style production engineering principles: clear ownership, fail-closed security, durable state, measurable SLOs, progressive delivery, and user-centered product design.

**Status:** The repository now has a production-oriented UI shell, role-separated navigation, authenticated PostgreSQL/Privy gateway composition, migration tracking, live-offer/order APIs, and recurring-order scheduling contracts. It remains pre-production until staging proves real identity, settlement, provisioning, reconciliation, browser UX, and operational recovery end to end.

## 1. Target product

ComputeX should feel like an enterprise cloud capacity marketplace. Customers discover and purchase verified GPU capacity; compute providers register and operate fleets; platform operations manage risk, settlement, evidence, and incidents.

Blockchain is the trust and settlement layer for:

- non-custodial payment and delivery-versus-payment;
- capacity entitlements;
- provider collateral and SLA evidence;
- cryptographic settlement receipts and auditability.

The default experience must use business language. Protocol details remain available through an advanced technical-details view.

## 2. Re-review findings

### P0 production blockers

- Client-side workspace state is presentation-only; server authorization is implemented against verified Privy access tokens and active organization membership, but still needs staging evidence with the real Privy tenant and database.
- Web deployment configuration now fails closed for both staging and production: RPC/WebSocket endpoints, Privy application ID, chain ID, and contract addresses must be explicit and valid. The committed production env file contains no deployment values, and the release build has been verified to fail without injected configuration. The deployment manifest and full RPC/WebSocket/contract validation still need to be centralized across every service.
- EIP-712 signing and service runtime configuration are fail-closed in production/staging; remaining default values are restricted to local/test environments and must be proven absent from release artifacts.
- Signature enforcement in the matching engine is now fail-closed across both `APP_ENV` and `COMPUTEX_ENV`: a conflicting local value cannot downgrade a release environment, and unverified orders are permitted only when an explicit local/development/test environment opts in. Release still requires deployment evidence that the flag is absent and signed orders are accepted end to end.
- The unsigned-order policy is now covered by a pure regression test matrix, including conflicting environment values, unknown environments, missing opt-in, and valid local opt-in, so future configuration refactors cannot silently reopen the downgrade path.
- PostgreSQL repositories, live-offer reads, migration tracking, append-only event schema, and recurring scheduler contracts now exist. Production still needs Cloud SQL deployment evidence, transactional command-side claims, offer ingestion, and reconciliation consumers.
- Credential delivery must use real provisioning output, short-lived credentials, revocation, and audit events. A locally derived address, key, or subnet is not proof of a provisioned allocation.
- Provisioning ingress now fails closed when provider-issued network details, host allocation metadata, credential expiry, or wipe evidence are absent; production still needs the authenticated controller-to-host transport and encrypted buyer delivery path wired end to end.
- Telemetry now traverses the authenticated gateway/workspace authorization boundary; the oracle is private to the Compose network and requires a gateway-to-oracle service credential. Production still needs per-allocation authorization and signed multi-oracle evidence rather than a single-process sample cache.

### P1 architecture and UX risks

- The application shell and primary navigation are now split by role; remaining protocol terminology is limited to technical evidence and advanced market surfaces, but should continue migrating behind explicit “Technical details” disclosure.
- Customer and provider flows are organized around their primary jobs: **Find Capacity** and **Register Fleet**; Evidence and Support are explicit destinations rather than silent wildcard redirects.
- The landing experience now asks for a clear Customer or Provider workspace, with business outcomes explained before authentication; workload details belong in the customer catalog rather than the sign-in decision.
- Public bootstrap now provides only theme and workspace intent; the full marketplace context (wallet reads, contract calls, private order state, and market-data sockets) remains behind authenticated-console lazy loading. This prevents unauthenticated visitors from opening private channels or paying the authenticated bundle cost.
- Some UI copy presents network timing, uptime, fee, or market claims as guarantees. Each claim needs an approved source, scope, timestamp, and legal/product owner.
- Local persistence remains in provider-node and wallet-related flows. Replace it with server-backed workspace resources; retain only harmless presentation preferences locally.
- Unit, workspace-build, and TypeScript lint/typecheck gates are green; browser journeys, accessibility, visual regression, load, reorg, recovery, dependency audit, and real integration evidence are still required.
- `npm audit --omit=dev` currently reports 2 high and 25 moderate transitive findings in the wallet/authentication graph; upgrades require a compatibility-tested dependency tranche rather than an unreviewed force upgrade.

## 3. Product navigation

### Public website

Top-level navigation:

- Platform
- For Customers
- For Compute Providers
- How It Works
- Pricing
- Security
- Network Status
- Documentation
- Sign In
- Get Started

The public site should lead with verified capacity, transparent procurement, measurable service quality, and enterprise controls. Do not display internal ports, contract addresses, debug logs, or service names.

### Customer workspace

Sidebar:

- Overview
- Find Capacity
- Orders
- Active Capacity
- Funding & Billing
- Service Health
- Evidence & Reports
- Support
- Settings

Primary journey:

```text
Find Capacity → Compare verified offers → Configure duration and quantity
→ Review total cost → Authorize payment → Track allocation
→ Receive verified access → Monitor health → Download evidence
```

The order book may remain available under an **Advanced Market View**, but it must not be the default customer home page.

### Compute provider workspace

Sidebar:

- Overview
- Fleet
- Capacity Listings
- Allocations
- SLA & Collateral
- Earnings & Settlements
- Incidents
- Evidence
- Support
- Settings

Primary journey:

```text
Register Fleet → Verify hardware → Complete health checks
→ Publish capacity → Serve allocation → Meet SLA
→ Receive settlement → Review evidence
```

### Platform operations workspace

This must be a separately permissioned operations surface:

- Operations Overview
- Settlement Queue
- Reconciliation
- Oracle Network
- Providers
- Capacity
- Incidents
- Risk & Compliance
- Audit Log
- Access Management
- Configuration

No customer or provider should see this navigation.

### Global application shell

The header should contain workspace switcher, environment badge outside production, network status, notifications, help, and account controls. Do not use a prominent buyer/provider toggle as the primary navigation mechanism. A person may belong to multiple workspaces, but each workspace has one clear persona and permission set.

Mobile navigation should expose four frequent destinations: Overview, Capacity/Fleet, Orders/Listings, and Active Capacity/Allocations. Alerts remain available from the persistent notification control and the More menu; everything else belongs under More.

### Current implementation delta to close before pilot

- The customer **Active Capacity** screen currently proves ERC-1155 voucher ownership only; a voucher is not yet an authoritative provider allocation. It must not be labeled provisioned or used as a provider instance identifier.
- The authenticated allocation metadata read path, private provisioning event path, and gateway credential proxy now exist. The provisioning controller now has an allocation-bound credential authority with expiry, revocation, audit hooks, and an authenticated private read surface. Production still requires a managed secret-vault adapter, real host-agent integration, credential rotation policy, and audited one-time delivery semantics; never derive SSH, WireGuard, endpoint, subnet, or allocation identifiers in the browser.
- Credential authorization grants are now abstracted behind a durable-store boundary, with a PostgreSQL adapter and migration for allocation, tenant, buyer, expiry, revocation, and vault-secret references. The authority no longer defaults to an in-memory grant store; the in-memory implementation is explicitly test/local-only. Production still requires wiring the provisioning runtime to PostgreSQL plus a managed secret-vault implementation and one-time delivery policy.
- Allocation reads now use the same bounded `(updated_at, allocation_id)` cursor contract as orders, with customer-side continuation for large active-allocation sets. History/allocation-detail UX and production load testing remain required.
- Customer service health is now queried by an authorized allocation ID; the gateway resolves the authoritative provider instance ID server-side and rejects cross-workspace or voucher/token-based lookups. Health responses still require freshness, source identity, signature, and oracle quorum metadata, and the provider-side multi-instance oracle integration remains a launch gate.
- Provider health requests now use a separate provider-node route authorized against the provider's own fleet inventory; the oracle rejects identifiers outside its configured instance. Multi-node probing and signed quorum metadata remain required before provider health can be treated as attestation evidence.
- The catalog and provider console now support authenticated offer publication, paginated live offers, and reservation primitives; production scale still requires staging proof of signed provider admission, the live inventory consumer, expiry handling, and an availability SLO. Do not manufacture hundreds of offers in the client.
- The repository now has a provisioning orchestration boundary that accepts settled-order work, reserves a provider, requires host-issued output, emits PREPARING/ACTIVE/UNAVAILABLE events, and exposes allocation-bound credential authority interfaces. The production host adapter, durable event transport, managed secret vault, operations console, settlement/reconciliation consumer, and end-to-end credential delivery remain release-critical workstreams, not UI polish.
- Provisioning events currently use a required bearer service credential over the private service topology. Before multi-tenant production scale, bind this identity to workload identity/mTLS, rotate it through managed secrets, and add dead-letter handling.
- Allocation lifecycle transitions now reject backward moves and terminal-state revival at the domain and SQL update boundaries; provisioning events now carry a positive sequence and PostgreSQL accepts only newer sequences. A PostgreSQL provisioning outbox now provides `SKIP LOCKED` leases, bounded attempts, retry scheduling, and dead-letter state, and allocation writes use the runtime transaction boundary when available. Production still needs a transactional database-backed producer in every event path and an alerting/replay worker.
- Allocation event ingestion is now idempotent at the PostgreSQL boundary: redelivery of the same event ID, allocation, type, and sequence returns the current authoritative allocation, while reuse of an event identity or sequence for different content fails closed. Production still needs deployed replay/duplicate-delivery exercises and alerting on event conflicts.
- The catalog and order workspace are now designed for enterprise inventory rather than a prototype card wall: live offers are server-filtered, cursor-paginated, freshness-aware, and loaded in bounded pages; orders are split into active, historical, and recurring views with stable cursors. Production acceptance requires load tests with at least 500 live offers and 1,000 mixed order records, with no unbounded API response, browser freeze, or loss of the current view during pagination.
- `scripts/verify-marketplace-scale.mjs` now provides a read-only staging acceptance check for that scale gate. It requires explicit real staging URL/token inputs, walks every cursor page, rejects pages over 100 records or 256 KiB by default, verifies unique identities, and enforces a configurable p95 response budget without seeding or fabricating marketplace data.
- The customer catalog now shows the complete live inventory by default; maximum hourly rate is an explicit opt-in filter, preventing valid higher-priced CPU/GPU listings from being silently hidden. The advanced market panel uses the same MON-denominated protected-balance source as order admission and clearly distinguishes customer purchase authorization from provider capacity listing.
- The customer catalog treats the client SKU registry as metadata enrichment only; unknown live offers remain visible as provider-defined capacity with explicit metadata-pending labels, so new CPU markets do not disappear until the frontend is redeployed.
- Purchase confirmation now revalidates offer availability, expiry, and requested duration against the latest live offer before wallet signing, and the review modal clearly identifies native MON as the balance used for the order while showing USDC separately.
- Purchase pricing now fails closed in application code for zero or invalid duration values, and the MON/hour field accepts precise decimal rates rather than imposing a browser-only two-decimal constraint.
- Public onboarding now uses workload-neutral language (CPU, GPU, and cluster capacity), replaces wallet/blockchain jargon with task language, and labels SLA figures as policy targets rather than unconditional guarantees. The authenticated connection indicator reports marketplace connectivity instead of exposing protocol timing in primary navigation.
- High-volume catalog filters now expose selected state through accessible pressed controls, use plain CPU/GPU/cluster labels, and provide a single Clear filters action that restores the complete live inventory view without silently retaining a price ceiling.
- The matching engine now routes independent order books and WebSocket depth/trade streams by ERC-1155 `token_id`, so CPU/GPU markets cannot contaminate one another as inventory scales. Production acceptance still requires multi-market load and failover tests across the intended SKU count.
- The engine WebSocket edge now applies explicit 64 KiB message/frame limits, a small read buffer, and a bounded 256 KiB write buffer to constrain malformed-payload and slow-peer memory exposure; production still requires load/failure-injection validation at the target connection count.
- Production web configuration now rejects missing and zero contract addresses during Vite configuration loading; CI uses nonzero validation addresses so the build gate cannot accidentally certify placeholder contracts. The mobile workspace test glob now executes its four integrity tests instead of silently running zero tests.
- Web deployment configuration now validates absolute RPC and market-data URLs and enforces HTTP(S) for RPC plus WS(S) for the market-data stream before a staging or production build can succeed.
- Contract balance and entitlement refresh is now visibility-aware and bounded to a 15-second interval, with an immediate refresh when a hidden tab becomes visible; this avoids multiplying unnecessary RPC load across authenticated marketplace sessions.
- The committed web production env is now an injection-only template; the integrity gate rejects deployment values in that file, while CI proves an explicitly configured production build succeeds and an unconfigured build fails closed.
- The production web container now requires explicit deployment build arguments and passes them into Vite; a Compose release cannot silently bake local RPC, WebSocket, contract, chain, or authentication defaults into the public image.
- CI now builds a deployment-configured web image separately from the local development Compose image and validates all required web variables in the production Compose contract.
- Local Compose validation no longer depends on an undeclared SLA address; the local-only manifest uses the checked-in local deployment value while the production manifest remains injection-only and fail closed.
- A standalone web image build now defaults to the fail-closed production posture; only the explicitly local Compose manifests opt into development mode.
- The API composition root now applies the same nonzero settlement-address and valid-chain startup checks as the web build, with a regression test covering zero-address rejection.
- The API composition root now also requires and validates the Monad RPC URL, and rejects any chain ID other than 10143 before creating the production pool or serving financial commands.
- `/ready` now supports a live dependency probe; the production gateway wires it to PostgreSQL so load balancers stop routing traffic when the control-plane database is unavailable.
- Production Compose now has a dedicated one-shot API migration job and gates gateway startup on successful schema migration. The release procedure must still run this job as an explicit deployment step in the orchestrator, retain migration logs, and alert on migration failure or lock timeout; application replicas must never run schema-changing migrations during startup.
- Production Compose now requires the PostgreSQL TLS mode and oracle endpoint explicitly; only local development manifests may provide topology defaults. CI supplies validation-only values and proves the production contract remains renderable.

## 4. UX and modern web design principles

- One primary action per page; secondary actions are visually subordinate.
- Use progressive disclosure: business outcome first, protocol evidence second.
- Every data surface must support Loading, Empty, Unavailable, Stale, Error, Permission Denied, Action Required, Confirming, and Completed states.
- Empty data must produce a useful call to action, never simulated balances, telemetry, trades, or provider activity.
- Use a calm enterprise visual system: high-contrast typography, restrained color, clear spacing, dense tables only where comparison matters, and no crypto-terminal visual noise by default.
- Keep transaction status human-readable: Authorization requested, Funds secured, Capacity matched, Network confirmed, Access preparing, Capacity ready.
- Make every irreversible action explicit with amount, asset, destination, fees, expected outcome, and confirmation status.
- Design for WCAG 2.2 AA, keyboard navigation, focus recovery, reduced motion, touch targets, screen readers, and responsive layouts.
- Design for localization from the beginning: timezone-aware dates, locale-aware numbers, currency abstraction, translated errors, and data-residency labels.
- Treat the customer workspace as a cloud-console product: Overview answers “what needs attention?”, Find Capacity supports comparison and procurement, Orders is the system of record for lifecycle state, Active Capacity is allocation/access status, and Funding & Billing is the financial control plane. Do not put protocol identifiers, raw contract addresses, or matching-engine diagnostics in the primary task path.
- Use a predictable page template across workspaces: title and one-sentence outcome, one primary action, status summary, main data surface, then secondary evidence/help. Preserve filters and scroll position during refresh, provide table/card density controls where useful, and make all destructive or financial actions reviewable before signing.

## 5. Terminology standard

| Protocol/prototype term | Product term |
|---|---|
| CLOB | Capacity Marketplace |
| Bid | Purchase Order |
| Ask | Capacity Listing |
| CLOB depth | Available Capacity |
| Compute Token | Capacity Entitlement |
| Escrow | Protected Trading Balance |
| Instance | Capacity Allocation |
| Node Operator | Compute Provider |
| Node | Compute Host or Provider Fleet |
| Bonded stake | SLA Collateral |
| Slashing | Collateral Adjustment |
| Oracle | Independent Health Verifier |
| CLOB online | Marketplace Connected |
| Oracle connecting | Health Data Unavailable |
| EIP-712 signature | Wallet Authorization |
| 400ms finality | Network Confirmation Target |

Ports, Rust service names, Solidity filenames, and internal implementation labels must not appear in normal end-user copy.

## 6. Target architecture

### Experience plane

Web and mobile applications with separate customer, provider, and operations workspaces. The frontend consumes versioned APIs and authenticated market-data streams; it does not own financial truth.

### Control plane

Identity, organizations, workspace permissions, capacity catalog, orders, billing, provisioning orchestration, notifications, support, and policy enforcement.

### Execution plane

Matching, allocation, provider health, provisioning, credential lifecycle, network access, and workload lifecycle.

### Settlement and trust plane

Onchain escrow, atomic settlement, capacity entitlements, provider collateral, oracle attestations, compensation, confirmation tracking, and reorg handling.

### Evidence plane

Append-only audit events, settlement receipts, SLA measurements, hardware attestations, access logs, compliance exports, and dispute evidence.

## 7. Enterprise-grade capability backlog

### Identity and governance

- Server-validated Privy identity and session lifecycle, with subject-to-wallet binding resolved from the identity database.
- Official Privy embedded wallets now participate in the shared signing path for email-authenticated users; external injected wallets remain supported. Staging must still verify wallet rotation, chain enforcement, recovery, and signing prompts with the real Privy tenant.
- Explicit workspace authorization policy separating customer procurement permissions from provider fleet/listing permissions.
- Workspace-scoped order reads use the verified principal's organization ID in addition to wallet binding; the client cannot select a tenant by request-body value.
- Durable identity schema and subject-to-workspace-principal repository for active membership and wallet binding.
- Production gateway composition root with TLS-default Cloud SQL pool, Privy authorizer, live-offer repository, and graceful shutdown.
- Transactional database migration command for the production control-plane schema.
- Production Docker topology now includes the API gateway, Nginx `/api/v1/` proxy, and a migration command for release automation.
- Production engine and telemetry images now compile the authoritative Rust workspace sources directly; CI builds both images so synthetic build-only targets cannot mask missing runtime code.
- Production Compose now keeps the API, engine, and oracle ports private to the Compose network, requires an explicit chain ID, and gates the public Nginx gateway on live health checks for all internal dependencies.
- Production services use an init process and explicit graceful-stop windows so API connections, engine WAL state, and oracle telemetry storage can drain and flush during rolling deploys.
- Production Compose no longer advertises an unconfigured HTTPS listener; TLS must terminate at the approved external load balancer or be added through a certificate-managed Nginx deployment before internet exposure, with forwarding, HSTS, and certificate-rotation checks as launch gates.
- Production Compose now binds the Nginx edge to loopback by default and includes an authoritative health check; internet exposure requires an explicit deployment decision and approved TLS load-balancer path rather than an accidental host-wide port publish.
- Nginx now applies baseline browser security headers (content-type sniffing, framing, referrer, permissions, and cross-origin opener/resource policies) without breaking wallet popup flows; HSTS remains the responsibility of the external TLS terminator.
- Nginx applies the baseline headers explicitly on cache-controlled SPA and asset locations as well as API routes, avoiding `add_header` inheritance gaps caused by location-specific cache directives.
- The public Nginx edge now enforces a 64 KiB request-body cap, bounded client header/body/send timeouts, timed-out connection reset, hidden version tokens, and bounded API upstream connect/read/write timeouts; long-lived market-data WebSockets retain their dedicated timeout policy.
- Nginx now disables upstream retries for the control-plane API, preventing a future multi-replica edge from replaying an ambiguous purchase, cancellation, funding, or recurring-order command.
- The API gateway now rejects bodies over the configured limit from `Content-Length` before buffering and enforces request, header, keep-alive, and per-socket request bounds to reduce slow-client/resource-exhaustion risk.
- The production gateway entrypoint now requires every runtime dependency, port, chain ID, and settlement address explicitly; it no longer supplies a default port, testnet chain ID, empty secret, or empty endpoint when launched outside Compose.
- CI now typechecks and tests the API gateway, verifies migration fail-closed behavior, builds the production API image, and validates production Compose interpolation.
- Migration execution is checksum-tracked in `schema_migrations`; changing an applied migration fails closed.
- The migration runner applies every ordered SQL migration, not only the baseline schema, within one transaction and records each checksum; a partial upgrade rolls back as one unit.
- API JSON request bodies are bounded at 64 KiB, oversized requests return `413`, and `/ready` is separate from `/health` for deployment probes.
- Provisioning outbox contracts now support idempotent enqueue, multi-worker leases, bounded retries, dead-letter inspection, and a single-flight monitored consumer with delivery/failure/dead-letter metrics. The production gateway composition root supplies a PostgreSQL transaction boundary and couples allocation state/event/outbox writes; the release gate is a deployed alerting and replay workflow.
- Signed purchase intents are persisted through an authenticated workspace command path; order IDs are deterministic from the signed nonce and PostgreSQL insertion is duplicate-safe for retries.
- The production gateway now journals the exact signed order command before engine admission and uses an atomic lease-backed `SUBMITTING` state, recording engine acknowledgement separately from ledger persistence. This prevents concurrent gateway submissions and the production composition root starts a bounded recovery worker that repairs expired/pending commands without asking the customer to sign again. The engine now restores accepted order identities from its WAL and acknowledges retries after restart without re-matching; deployed restart-recovery and WAL-compaction tests remain required for the release gate.
- PostgreSQL order creation now returns the persisted authoritative record on an idempotent retry and rejects reuse of an order ID with different signed order content, preventing false acceptance of conflicting commands.
- The file-backed order ledger used by local/staging recovery now enforces the same immutable-intent idempotency contract as PostgreSQL, so environment changes cannot reintroduce duplicate or conflicting order acceptance.
- Order cancellation is now a fail-closed, workspace-scoped command: the gateway requires matching-engine acknowledgement before transitioning the durable ledger, and already-cancelled orders are idempotent on retry. The remaining launch gate is reconciliation for engine/ledger disagreement and settlement-stage cancellation policy.
- Gateway-to-engine command traffic now uses a dedicated authenticated `/ws/v1/control` WebSocket for buyer purchase admission, provider listing admission, and cancellation; the public `/ws/v1/depth` channel remains available for browser market data. The gateway verifies workspace scope and EIP-712 authorization, checks idempotent retries before admission, submits the signed order to the engine, and only then writes the durable order record. The current JSON control contract rejects values above JavaScript's safe integer range until the wire format carries u64 values as strings or binary fields.
- Frontend environment defaults now target the explicit public `/ws/v1/depth` channel; the gateway control URL must independently target `/ws/v1/control`.
- Recurring policies now have organization-scoped creation, pause, resume, and cancel commands with confirmation UX, plus a PostgreSQL `FOR UPDATE SKIP LOCKED` lease repository with atomic completion/failure updates; financial approval, executor integration, and renewal evidence remain launch gates.
- Recurring policy creation now requires a separate EIP-712 wallet mandate covering maker, capacity, amount, maximum rate, interval, nonce, and expiry; the gateway recovers the signer cryptographically, persists the mandate, and the scheduler excludes legacy or expired policies without one. Users can rotate the mandate in place before expiry; real delegated settlement execution and revocation semantics remain launch gates.
- Recurring policy creation now requires a validated `Idempotency-Key`; the key deterministically names the policy, retries return the same durable policy, and conflicting reuse fails closed. The browser client sends the key for every create attempt, while the Postgres and in-memory ledgers compare the full policy intent before accepting a retry.
- The catalog now binds recurring-policy retry keys to the signed purchase nonce (`purchase-<nonce>`), so a transport retry of the same procurement intent cannot create a second renewal policy; launch validation must still exercise refresh, reconnect, and double-submit scenarios in staging.
- Compact navigation now exposes all workspace destinations through the responsive `More` menu, including evidence, support, and settings; no customer or provider workflow is desktop-only.
- Global brand navigation and theme controls are now semantic keyboard-accessible buttons with visible focus treatment, closing a common shell-level accessibility failure that component-level workflow tests can miss.
- The workspace overview now labels connectivity as “Marketplace connected/reconnecting” instead of exposing matching-engine implementation language in the primary customer status surface.
- Destructive order and recurring-policy actions now use an in-product, focus-trapped confirmation dialog with explicit consequences; browser-native confirmation prompts are no longer part of the customer workflow.
- Provider node removal and capacity-listing cancellation now use the same accessible in-product confirmation pattern; providers cannot accidentally deregister hardware or withdraw a listing with a single unreviewed click.
- ERC-1155 entitlement balances are now read with one live multicall across all catalog token IDs instead of only token `1`, so valid CPU/GPU/cluster capacity cannot disappear as the catalog grows; unknown token IDs still require an indexed metadata service before they can be rendered with hardware details.
- Active, history, and recurring order views are now URL-backed (`/buyer/orders?view=...`), preserving the selected workspace context across refreshes and allowing support/operations links to open the correct order surface directly.
- Catalog search, category, region, sort, and price-ceiling state are now URL-backed on `/buyer/marketplace`, using replace-state updates so shared procurement views do not pollute browser history.
- The global catalog region filter now includes all supported deployment regions: US East/West, Europe Frankfurt/Dublin, and Asia Tokyo/Singapore.
- Order-ledger outage states are now actionable: active, historical, and recurring views show truthful service-unavailable notices with a retry action instead of silently looking empty or requiring a full page reload.
- Active, historical, and recurring order reads now track independent endpoint status. A recurring-order outage no longer hides usable active or historical orders, and each view retains its own loading, unavailable, retry, and pagination state.
- Order search is now server-side and tenant-scoped for PostgreSQL (order ID, token ID, and lifecycle status), with bounded query length and a matching local/staging fallback. This prevents a paginated ledger from reporting a false no-match result because the requested record is beyond the first page; production still requires search latency and query-plan validation at representative scale.
- The customer order workspace now exposes Active orders, Order history, and Recurring orders as URL-addressable tabs with linked accessible tab panels and dedicated search affordances, supporting large operational ledgers without collapsing distinct lifecycle states into one list.
- The order workspace tablist now follows standard keyboard roving behavior: Arrow keys, Home, and End move focus and update the URL-backed view while preserving a single tab stop for keyboard users.
- The compact workspace “More” menu now exposes menu semantics and Arrow/Home/End navigation, while the focus trap restores focus to the trigger after dismissal.
- Compact navigation now uses short mobile labels with full screen-reader names and a resilient horizontal overflow treatment, keeping primary destinations reachable on narrow phone widths.
- Active items in the compact More menu now expose `aria-current="page"`, aligning visual and assistive-technology route state.
- Active, historical, and recurring order tables now expose screen-reader captions and explicit column headers, preserving context when a large ledger is navigated non-visually.
- Legacy `/buyer/billing` deep links now canonicalize to `/buyer/funding`, keeping one financial control-plane destination while preserving existing shared links.
- Recurring orders now have a dedicated search field using the same authoritative query path as active and historical orders, with capacity-model and lifecycle-state matching retained in the client for clear empty states.
- Order tabs now show the number of loaded records and a truthful `+` continuation marker when another server page exists; unavailable counts remain `—`, avoiding false global totals in large ledgers.
- Live catalog requests now have an eight-second client timeout; stalled gateway calls transition through the existing truthful error/unavailable states instead of leaving buyers in indefinite loading.
- Order-ledger reads now use an eight-second deadline and order/recurring commands use a fifteen-second deadline, preventing stalled authenticated requests from leaving lifecycle actions indeterminate in the browser.
- Provider SLA collateral reads are now instance-scoped; the client no longer queries a hardcoded instance ID. Until the authoritative fleet selection supplies an instance, the UI shows collateral as unavailable rather than attributing another instance’s stake.
- Provider staking now requires an explicit numeric onchain SLA instance ID and passes that ID to the contract; catalog token IDs and provider node labels can no longer be misused as collateral policy identifiers.
- Provider telemetry now requires a valid status, sample timestamp, uptime measurement, and latency measurement; missing fields leave the node pending rather than substituting zeroes or a client-generated timestamp.
- Provider fleet API calls now have an eight-second deadline, and telemetry refreshes use a monotonic request sequence so an older asynchronous probe cannot overwrite a newer fleet state.
- Provider fleet outage states now include an in-product retry action, so providers can recover from a transient fleet-service failure without a full-page reload or mistaking an unavailable response for an empty fleet.
- Provisioning reservations are now buyer-bound, voucher-bound, and time-bounded; provisioning rejects ownership mismatches, expired reservations, and missing host-agent network output before moving a node to ACTIVE.
- Organization/workspace membership and invitation flows.
- RBAC first, policy-based authorization for advanced enterprise controls.
- SSO/SAML/OIDC and SCIM.
- Spend limits, approval workflows, wallet allowlists, and step-up authentication.
- Immutable audit of administrative and financial actions.

### Marketplace and settlement

- Canonical order schema shared by frontend, gateway, SDK, and engine.
- Live capacity-offer API with cursor pagination, freshness/expiry metadata, provider identity, inventory status, parameterized search, server-side category/region/price filters, and stable price/capacity/freshness sorting.
- Capacity taxonomy is server-owned (`CPU`, `GPU`, `CLUSTER_POD`, or `UNKNOWN`) and persisted on each offer; the client SKU registry is enrichment only. Provider ingestion must classify new hardware at write time, while `UNKNOWN` remains visible with truthful metadata-pending treatment until enrichment is verified.
- Provider offer writes now materialize live `capacity_offers` only against an authenticated, active provider node, refresh availability/expiry atomically, support owner-scoped retirement, and expose a wallet-scoped cursor-paginated provider listing read. The provider console now renders this durable inventory ledger rather than transient order-book asks; production still requires staging proof of inventory reservation on every fill, expiry handling, and reconciliation against settlement/provisioning state.
- Live offer reads now require the joined provider node to remain active (`removed_at IS NULL`), preventing soft-deleted/decommissioned hardware from reappearing in either the global customer catalog or the provider’s own listing view.
- Reservation admission now repeats that active-node invariant inside the transactional capacity decrement, so a reservation racing with provider-node removal fails closed instead of consuming decommissioned inventory.
- A transaction-required capacity reservation ledger now atomically records `RESERVED`/`COMMITTED`/`RELEASED` capacity, adjusts offer availability, and includes an expiry reaper; launch still requires the match/settlement consumer to call it for every fill and reconciliation of reservations against onchain settlement and provisioning state.
- The gateway exposes reserve/commit/release/reap only on a private service-authenticated route with a credential distinct from provisioning; the settlement-keeper package now includes a typed HTTP client for that boundary. Deployment still requires wiring the client into the live fill/settlement worker and rotating the service credential through the approved secret manager.
- The settlement keeper now exposes reservation-aware batch hooks and the reconciliation engine reports reservation drift; the operator runbook documents pause, evidence collection, and controlled reservation recovery. Production still requires live deployment of the worker/client path and an alert-backed end-to-end drill.
- Settlement journal recovery and writes now fail closed: corrupt journal data aborts startup, and every state transition is fsynced before the keeper continues. Production still requires replicated durable storage and restore/replay drills.
- Customer catalog renders individual live offers (not one synthetic card per hardware type), queries the full inventory through the API, and exposes bounded cursor pagination for large inventories.
- Catalog defaults to a dense comparison table for scale, with an explicit card view for visual browsing; both views use the same live filters, bounded pagination, freshness metadata, and procurement action.
- The advanced trading view no longer labels a price-sorted static enrichment list as fleet capacity; unsupported capacity identifiers and ordering labels now remain truthful.
- Catalog pagination now preserves visible live offers while fetching the next page and retains loaded results if a later page request is temporarily unavailable; large-inventory navigation no longer blanks the customer workspace during pagination.
- Catalog pagination now makes the primary Next control cursor-aware: when a customer reaches the end of loaded results, it fetches the next server page and advances only after a successful response. This keeps large CPU inventories navigable without requiring users to discover a separate secondary Load more action.
- Active and historical order pagination now uses the same cursor-aware primary Next behavior, and recurring policies now render bounded pages with explicit loaded-count/continuation state. Failed cursor requests leave the current page intact and expose a retryable next-page message.
- Signed browser order-ledger writes now include a deterministic `Idempotency-Key` derived from the signed order ID/nonce, giving edge retries an explicit request identity while leaving cryptographic authorization as the actual admission control.
- The gateway now validates any supplied order idempotency header against the exact signed order ID, rejects mismatched keys, and echoes the canonical key on successful create/replay responses. This makes the browser retry contract enforceable at the financial command boundary rather than advisory only.
- The API gateway now has a top-level async request error boundary: unexpected dependency failures are logged with the trace/request identifier and returned as a stable non-sensitive `InternalServerError`, while partially-written responses are safely destroyed. This prevents unhandled rejections from producing ambiguous client behavior.
- Order view search context is now shareable through the URL (`view` plus the active view's `q`), uses replace-state to avoid browser-history churn, and hydrates correctly on back/forward navigation or a support link opened in a new session.
- Order-view transitions now update `view` and the destination view's search query atomically, preventing an Active-order search from leaking into History or Recurring when users change tabs.
- Cursor pagination for Active, History, and Recurring orders now carries the same server-side search query on every page and refreshes its callback dependencies when that query changes, preventing cross-result contamination during large-list browsing.
- Live catalog and order cursor pages now merge by authoritative offer/order/policy ID, with later records winning on overlap. Mutable inventory or ledger boundaries therefore cannot create duplicate rows or retain an older duplicate state in the customer workspace.
- The global capacity region selector preserves the known human-readable regions while dynamically adding regions observed in live provider offers, so onboarding a new geography does not require a frontend release before customers can filter to it.
- History and recurring-order views now expose task-oriented status selectors (completed/cancelled/failed or expired; active/paused/cancelled), reset pagination when changed, and preserve truthful empty results. This reduces ledger scanning time without hiding the underlying authoritative records.
- History and recurring status filters now travel with every authenticated ledger request and are applied in the PostgreSQL query path before cursor pagination. Customers therefore search the complete order set instead of filtering only the first 100 records held in the browser; invalid status values fail with a deterministic 400 response.
- The selected order view, search text, and status filter now share one canonical URL state, so a customer or support operator can deep-link to the exact active, historical, or recurring ledger slice without losing context on refresh or back/forward navigation.
- Default customer and provider activity surfaces now use “Marketplace activity”, “Marketplace matches”, and “Settlement pending” language instead of exposing “matching-engine” or “active session” implementation terms; the distinction between a live match and confirmed settlement remains explicit.
- Migration `012_order_status_query_indexes.sql` adds wallet/status/keyset-order indexes for history and recurring filters, keeping the new full-ledger queries aligned with the cursor ordering as customer workspaces scale.
- Contract balance and provider-collateral polling now carries a request generation guard and invalidates in-flight reads during wallet, instance, or unmount changes. A slow prior RPC response can no longer overwrite the current workspace's financial state; staging should still exercise chain outages and account switching.
- The read-only marketplace scale acceptance check now traverses recurring orders in addition to active/history records and fails on duplicate authoritative IDs across cursor pages. It remains intentionally staging-only and requires a real authenticated token; it never seeds synthetic inventory or order data.
- The desktop workspace sidebar is now sticky with an independently bounded scroll region, keeping procurement, order, funding, and support navigation available while customers review long catalogs or order tables; compact navigation remains unchanged below the desktop breakpoint.
- Catalog cursor requests now surface HTTP 503 degradation as a visible retryable notice, preserving the loaded result set instead of silently leaving a non-functional “load more” control.
- Catalog counts now distinguish loaded client pages from the server's unknown total and explicitly disclose when more cursor-paginated inventory is available, preventing misleading capacity totals at marketplace scale.
- Capacity discovery now uses procurement-oriented “market detail” terminology and explicit labels/relationships for search, hardware, region, sort, rate, and view controls, improving keyboard and assistive-technology navigation without removing the advanced order-book path.
- Provider dashboard KPI navigation now uses semantic, keyboard-operable buttons rather than clickable layout containers; order-ledger pagination also ignores stale request cleanup so rapid navigation cannot expose an incorrect loading state.
- Customer dashboard KPI navigation now uses native buttons as well, restoring expected Enter/Space behavior for the primary entitlement, funding, order, and health destinations.
- Desktop workspace navigation now groups destinations by user intent (Procurement/Operations, Finance & assurance, and Help) while preserving the role-exclusive customer/provider information architecture; this reduces scan cost as lifecycle surfaces expand.
- Interactive workspace controls now explicitly declare `type="button"` throughout customer, provider, marketplace, telemetry, and shared state components, preventing accidental form submission and making keyboard activation behavior deterministic. The remaining accessibility gate is automated WCAG/keyboard and visual validation in a real browser journey.
- The UI interaction contract is now enforced by `scripts/verify-ui-contract.mjs`, the standard `make lint` target, and CI; regressions that add a button without an explicit type or an unsafe new-tab link without `noreferrer`/`noopener` fail before merge.
- The shared design system now honors `prefers-reduced-motion`, including live status indicators, loading animations, transitions, and theme view transitions; automated WCAG and browser validation remain required before launch.
- Advanced market catalog asset cards now use native pressed buttons, keeping CPU/GPU market selection keyboard-accessible when customers open the technical market-detail view.
- The technical market directory now explicitly labels static SKU metadata and reference rates as specifications, directing customers to the live offer feed for purchasable availability and price.
- Live catalog token identifiers now remain decimal strings through display and purchase signing; known SKUs are enriched by exact string comparison, preventing JavaScript numeric precision loss for future provider-defined markets.
- Offer and active-allocation pagination now exposes retryable errors while preserving the current result set and cursor; a temporary page failure no longer becomes a silent partial-inventory condition.
- Public market-data WebSocket reconnects now use teardown-safe exponential backoff capped at 30 seconds, preventing duplicate sockets and reconnect storms during route changes or outages.
- The mobile client no longer seeds depth, trades, telemetry, credentials, balances, block numbers, or local private keys; it renders explicit no-verified-data states until configured authenticated feeds and wallet signing are available.
- Catalog controls now make result ordering and maximum hourly rate explicit; model/provider/region search is executed against live offer and provider metadata rather than a partial client-side page.
- PostgreSQL now has `pg_trgm` GIN indexes for the catalog's case-insensitive substring search across provider, region, token, GPU model, datacenter, and interconnect metadata; production must verify extension availability and query plans with representative inventory.
- Evidence and Support routes now render explicit workspace states for both personas; selected navigation destinations no longer fall through to Overview.
- Evidence is presented as a scoped register with search/export affordances and truthful empty states, while Support provides role-specific routing for orders/listings, access/allocations, billing/settlements, and service health instead of prototype “coming soon” copy.
- Evidence search and export controls are visibly disabled until a signed-evidence query source exists, preventing dead controls from implying unsupported functionality.
- Responsive web navigation now prioritizes four frequent tasks and places secondary destinations behind a labeled More menu, avoiding unusable horizontal tab overflow on small screens.
- The compact More menu now has an explicit menu relationship, menu-item semantics, and focus trapping with Escape/return-focus behavior, so every workspace destination remains keyboard-usable on narrow screens.
- The responsive More menu now closes on outside click and Escape and exposes an explicit controlled relationship for assistive technology.
- The web bootstrap now lazy-loads authentication and the application shell, and the authenticated console now mounts marketplace, wallet, order-book, and provider-fleet code only after Privy confirms a session; this keeps the public entry lightweight and buyer/provider routes independently cacheable. The production build still reports an authentication vendor chunk above 500 kB; this remains a performance-gate item requiring dependency-level analysis or an approved budget exception, not a warning to suppress.
- The advanced customer market view no longer renders the static SKU directory as inventory; the live catalog remains the source of available offers, while the advanced panel is scoped to the selected market and its live depth/custom-order controls.
- Customer page headers now use task language (`Find Capacity`, `Orders`, `Active Capacity`, `Funding & Billing`, `Service Health`) and only expose the funding action on purchase/funding pages; protocol details remain secondary.
- Provider listing and account surfaces now use customer-facing language (`Listing Rate`, `Active Capacity Listings`, `Claimable Earnings`, `Marketplace connected`) while retaining protocol vocabulary only in explicitly advanced market/evidence contexts.
- Provider allocation surfaces no longer present recent fills as active sessions or display an invented SLA percentage; matched activity and authoritative allocation/SLA evidence are explicitly separated, with unavailable evidence shown as such.
- Normal customer/provider flows now use capacity listings, allocations, service commitments, and settlement network language; chain IDs, protocol order names, and cryptographic implementation details remain reserved for technical/evidence surfaces.
- The authenticated application footer now uses neutral network/SLA language and no longer exposes the raw chain ID or universal-looking timing/uptime claims in normal navigation.
- The authenticated footer also uses “Protected delivery and payment” instead of the protocol acronym `DvP`, keeping customer navigation understandable without prior blockchain knowledge.
- Primary funding, network-status, and order-lifecycle surfaces now use customer terminology; protocol labels remain available only in advanced technical/evidence contexts.
- Customer and provider task flows now replace remaining prototype jargon such as resting commitments, vouchers, matching-engine labels, oracle quorum, and onchain alerts with open purchase commitments, capacity entitlements, marketplace activity, independent health verification, and settlement-network alerts.
- Live health status is no longer enabled or suppressed by static hardware-SKU metadata: customer allocation health and provider fleet verification always query the authenticated telemetry boundary, and unavailable responses remain visibly pending/unverified.
- Authentication consent now exposes the legal-document action separately from the consent checkbox, with an explicit accessible description; browser accessibility review confirmed distinct workspace radios, email input, consent control, and agreement action in the public entry flow.
- API responses now receive uniform cache-control, browser hardening, permissions, CSP, authorization variance, and W3C trace/request identifiers across health, data, command, and error paths; production still requires trace export into the selected observability backend.
- Settlement-network status in the account menu is now derived from the live contract-read state and distinguishes confirmed, checking, and unavailable; a failed RPC read can no longer appear as a healthy green network indicator.
- Production API metrics are now protected by a dedicated internal bearer token; health/readiness remain separately usable by container orchestration, and local composition can omit the token for test-only servers.
- Database migrations now serialize across replicas with a transaction-scoped PostgreSQL advisory lock and bounded lock/statement timeouts, preventing concurrent rollout races and indefinite DDL waits.
- The migration runner now delegates complete SQL files to PostgreSQL instead of splitting on semicolons, preserving future trigger/function migrations and dollar-quoted procedural bodies.
- Migration execution is now isolated in a tested runner module; regression coverage proves complete procedural SQL files are submitted intact and that the transaction commits only after checksum records are written.
- Public Nginx ingress no longer exposes engine metrics or the private engine control WebSocket path; observability must scrape private service listeners and the gateway control connection remains container-network-only.
- The customer overview now distinguishes authoritative active provider allocations from onchain capacity entitlements; it never presents voucher ownership alone as provisioned capacity or active usage.
- The customer overview allocation panel now uses authoritative allocation records for active capacity; funding runway remains explicitly unavailable until an authoritative usage-rate feed exists, rather than inferring spend from static SKU prices.
- Funding & Billing now exposes the real protected balance while withholding burn-rate, runway, and monthly projections until a verified billing/usage feed is connected.
- The customer Usage & Billing view now labels unavailable financial projections as verified usage, balance coverage, and monthly estimate; no placeholder metric implies that a rate or projection exists before the billing feed is authoritative.
- Live activity tables never synthesize trade or settlement identifiers when an upstream event omits one; they show an explicit pending-reference state until the authoritative identifier arrives.
- Active Orders prefers authenticated durable ledger records over transient market-stream state; transient rows are used only as an explicit degraded fallback while the ledger is unavailable. Buyer purchase admission, provider listing admission, and durable cancellation now pass through gateway-controlled engine commands; reconciliation for engine/ledger disagreement remains a launch gate.
- Active and historical order reads are now bounded to 100 records per response and use stable `(updated_at, order_id)` cursors; the customer workspace can explicitly load additional history without unbounded database responses.
- Recurring policy reads use the same bounded, stable cursor contract and the customer workspace exposes explicit continuation for large policy sets.
- Order and recurring-order endpoints reject malformed cursors deterministically rather than returning an unhandled server error.
- Catalog and order-ledger hooks discard stale responses when users change filters or refresh while pagination is in flight, preventing older data from replacing a newer workspace snapshot.
- Mandatory signature, nonce, expiry, chain, contract, and maker validation.
- The HTTP order-ledger ingress now cryptographically recovers the EIP-712 signer and rejects expiry, maker, direction, payload, and ephemeral-key mismatches before durable persistence; production composition fails closed if the verifier is absent.
- WebSocket market events preserve raw wei/second and second quantities; customer/provider commitment, settlement, notification, and overview totals use bigint arithmetic and exact formatting rather than floating-point money calculations.
- The TypeScript SDK now canonicalizes ephemeral secp256k1 private keys to exactly 32 bytes (`0x` plus 64 hex characters), preventing intermittent credential-encryption failures caused by omitted leading zero nibbles.
- Provider collateral and claimability UI decisions now compare exact parsed MON base units rather than `parseFloat`, eliminating precision-dependent enable/disable behavior for financial actions.
- The authenticated header now renders already-formatted onchain balances as exact strings rather than converting them through JavaScript `Number`, preventing rounded or misleading financial values in the global navigation.
- Order-book canvas labels now derive price, size, and total values from raw wei/second and capacity-second strings; floating-point values are retained only for non-financial bar geometry, preventing display rounding at large order sizes.
- Browser order-book and provider-listing adapters now retain token IDs and engine order/match references as strings at the transport boundary; catalog lookups use exact string identity instead of JavaScript `Number` coercion, preserving correctness for future high-range ERC-1155 markets.
- Normal customer/provider activity, funding, withdrawal, error, and lifecycle surfaces no longer expose chain IDs, contract function names, or protocol implementation terms; those details remain limited to configuration and explicitly advanced audit surfaces.
- Customer/provider execution duration displays and CSV exports now format from the raw second quantity, avoiding precision loss from browser floating-point conversion.
- Onchain MON, USDC, and stake balances are formatted directly from base units; customer-facing gross order value and protocol fee labels now match the actual settlement asset and cannot silently present MON as USD.
- Funding, withdrawal, provider-claim, and SLA-collateral input validation now parses user amounts into exact MON/USDC base units before comparing against balances; malformed or over-limit values are rejected before a wallet transaction is requested.
- The current production dependency audit remains a launch blocker: 27 transitive findings (25 moderate, 2 high) remain in the Privy/wallet dependency graph. Automated overrides were evaluated and rejected because they produce incompatible nested package resolutions; remediation requires coordinated upstream upgrades and a clean `npm ci`/audit/build verification, or a formally approved risk exception.
- The web workspace no longer declares the unused `echarts` runtime dependency; the lockfile and clean install were verified without it, reducing supply-chain and install surface without changing the product runtime.
- A measured Vite vendor-splitting trial was rejected: grouping the wallet SDK family produced a 4.2 MB Privy chunk, materially worse than the existing route/vendor graph. The build keeps route-level lazy loading and retains the >500 kB performance item for dependency-level remediation rather than hiding it with a warning threshold or shipping a larger bundle.
- A clean-install audit confirmed the two high findings are transitive (`axios` through Coinbase CDP and vulnerable `ws` through nested WalletConnect/Viem packages). Root-level overrides were not retained because they make the dependency tree invalid; the release process must track upstream fixed ranges and prohibit publishing until `npm ci`, `npm ls`, audit, build, and integration tests all pass.
- The current clean-install dependency trace confirms Axios 1.16.0 and nested Viem 2.36.0/2.23.2 remain selected by exact transitive ranges; a trial override was rejected because npm did not apply it to the lockfile-resolved workspace graph. Remediation must come through compatible upstream Privy/WalletConnect/Coinbase releases or a formally reviewed dependency fork, not an unverified root override.
- The dependency-audit exception window is now enforced in code and expires at the documented 2026-10-08 UTC deadline; CI cannot silently carry the current transitive-risk approval past its review date.
- CI now generates and retains a CycloneDX production dependency SBOM alongside the audit result, providing an immutable release-review and incident-response inventory.
- CI now declares repository read-only token permissions by default, reducing the blast radius of third-party actions and build tooling.
- The production Nginx edge now emits a restrictive Content Security Policy in addition to the existing browser hardening headers; it permits same-origin application assets and HTTPS/WSS identity, RPC, and explorer integrations while blocking framing, plugins, and arbitrary form destinations. The Alpine container configuration was syntax-validated with service upstreams resolvable.
- Explorer URLs are centralized in the network configuration, so wallet setup, settlement receipts, notifications, and account verification cannot drift to different network explorers.
- CI now runs `npm audit --omit=dev --audit-level=high` in both static analysis and full-test jobs; no release may bypass the high-severity gate without an explicit security risk exception and compensating controls.
- Durable order and fill event log.
- Idempotent submission and retry keys.
- Settlement queue with confirmation policy, reorg handling, stuck-transaction recovery, and reconciliation.
- Engine slashing calldata now uses generated Solidity ABI encoding and the canonical function selector; placeholder calldata is prohibited. Onchain submission, receipt tracking, and reorg recovery remain launch gates.
- Recurring procurement scheduler with database leases, deterministic run keys, retry policy, and budget/approval enforcement.
- Daily onchain/offchain balance reconciliation with operator alerts.

### Provider and provisioning

- Hardware identity and attestation registry.
- Live telemetry with freshness, source, signature, and quorum metadata.
- Secure bootstrap and key rotation.
- Short-lived credentials, revocation, access expiration, and wipe verification.
- Network isolation, customer data deletion, quarantine, and rollback.
- Provider incident and dispute workflow.

### Security, reliability, and operations

- Private service networking, mTLS/service identity, least privilege, and managed secrets.
- API rate limits, WebSocket authentication, tenant isolation, schema validation, and abuse controls.
- Central logs, metrics, traces, audit events, and alert routing.
- Backup/restore, disaster recovery, replay, emergency pause, and rollback drills.
- Smart-contract audit, threat model maintenance, dependency/container scanning, SAST/DAST, and penetration testing.
- Documented support severity model and customer communication procedures.

## 8. Delivery roadmap

### Phase 0 — Product contract and architecture baseline (1–2 weeks)

Define personas, workspace boundaries, capability/permission matrix, terminology, state machines, page inventory, analytics events, and approved product claims. Exit when every screen has a single primary job and no mixed-persona navigation.

### Phase 1 — Security and configuration hardening (2–3 weeks)

Remove placeholder values and fallback addresses, enforce production configuration validation, make signature checks fail closed, replace client authorization with server authorization, and establish secret management. Exit with negative security tests and a clean CI baseline.

### Phase 2 — Durable financial core (4–6 weeks)

Implement durable order/fill/settlement state, idempotency, event replay, chain confirmation tracking, reconciliation, pause controls, and operational dashboards. Exit with restart, retry, reorg, and failure-injection tests.

### Phase 3 — Provider trust and provisioning (4–6 weeks)

Implement live hardware attestation, telemetry freshness, oracle quorum evidence, secure provisioning, the allocation-scoped credential read/revoke path, credential rotation/revocation, provider quarantine, and durable provisioning event delivery. Exit with real hardware/testnet integration and an auditable access lifecycle; the customer UI must show voucher entitlement, allocation preparation, active allocation, expired, revoked, and unavailable as distinct states.

### Phase 4 — Production UI rebuild (6–8 weeks, parallel)

Deliver the new application shell, customer workspace, provider workspace, operations workspace, design system, terminology migration, transaction timeline, honest data states, accessibility, responsive behavior, and end-to-end journeys. Validate the customer journey against hundreds of live offers and active/history/recurring order states, including stale data, partial outage, permission denial, pending authorization, settlement confirmation, provisioning delay, access revocation, and failed renewal. Treat technical vocabulary as an advanced/evidence-surface exception; normal task paths must use the terminology dictionary and explain every unavailable or pending state in business language.

### Phase 5 — Enterprise platform (4–8 weeks)

Add organizations, SSO, SCIM, approvals, spend policy, invoice/export workflows, support tooling, regionalization, data retention, and compliance evidence.

### Phase 6 — Pilot, audit, and launch (4 weeks)

Run a controlled provider/customer pilot, complete security and contract audits, load test p99 behavior, execute disaster recovery, validate support operations, and release progressively behind feature flags.

## 9. Success measures

### User experience

- First meaningful action in under two minutes.
- Customer finds a viable capacity offer in under one minute.
- More than 90% completion for critical customer/provider tasks.
- Critical UI error rate below 1%.
- No unexplained or synthetic values in production.
- WCAG 2.2 AA compliance and strong Core Web Vitals.

### Platform

- API and control-plane SLOs defined and measured.
- Order acceptance, matching, provisioning, settlement, and reconciliation have p50/p95/p99 dashboards.
- Every financial state is replayable and reconciled.
- Every privileged action is attributable to a user, service identity, or signed transaction.
- Recovery objectives, backup tests, and incident exercises are proven—not only documented.

## 10. Immediate next ten actions

1. Deploy the API gateway against Cloud SQL and a real Privy staging tenant; prove identity, wallet binding, tenant isolation, migration rollback, and authenticated buyer admission through the private engine control channel.
2. Create one canonical runtime/contract manifest and validate every production dependency at startup.
3. Make engine signature enforcement and settlement confirmation/reorg handling mandatory in production.
4. Connect the order command state machine to real matching, settlement, reconciliation, provisioning, and credential delivery.
5. Connect the authenticated allocation API and private provisioning event path to real provisioning workers; replace voucher-derived instance/credential assumptions with authoritative allocation records and audited credential retrieval.
6. Migrate all UI copy through the shared terminology dictionary and remove technical leakage from customer/provider flows; verify every production command remains behind the gateway admission boundary.
7. Add browser journey, accessibility, visual regression, load, integration, and failure-injection tests.
8. Add budget approvals, recurring-order policy controls, notification preferences, and audit exports.
9. Validate the catalog search migration on the target PostgreSQL service, capture `EXPLAIN (ANALYZE, BUFFERS)` plans at representative scale, and add a search latency SLO/alert.
10. Remove the time-boxed Axios/`ws` transitive dependency exceptions by upgrading the Privy/Base/WalletConnect chain when patched vendor releases are available, then produce an SBOM plus image scan report; the CI audit gate already fails closed for new or critical findings.
11. Complete contract/security reviews, backup restore, disaster recovery, and incident exercises, then run a staged pilot with production observability, reconciliation, support, rollback, and incident procedures.

## 11. Release decision

Do not call the system production-ready based only on passing unit tests or a successful frontend build. Release requires passing the security, durability, operational, integration, UX, accessibility, and recovery gates above, with evidence from a staging environment that uses real contract addresses, real telemetry, real provisioning, and real authenticated identities.
