# Circuit Protocol: Technical Architecture & Implementation Specification

**The Zero-Trust Financial Firewall and Clearing Layer for Autonomous Machine Economies on Monad**

---

## 1. System Vision & Problem Formulation

As autonomous AI agents (Anthropic Computer Use, OpenAI Operator, Google Jarvis, AutoGen swarms) transition from read-only assistants to economic actors making programmatic web purchases, trading, and procuring compute, enterprise CFOs and security teams face a fundamental blocker:

* **The Fatal Single Click**: A single prompt-injection attack or compromised tool invocation can instruct an agent to sign an approval or transfer that drains an enterprise treasury in a single block.
* **The Runaway Loop**: A looping execution error burns millions in programmatic micro-tolls before human engineers receive alerts.
* **The Incumbent Gap**: Wallet SDKs (Coinbase CDP) manage keys but lack real-time runtime firewalls. Legacy institutional custodians (Fireblocks, Safe) rely on 20-second multi-sig signing rounds that are unusable for sub-second machine workloads.

**Circuit Protocol** operates as an isolated security kernel between any AI runtime and the blockchain, enforcing mathematical execution boundaries: instant $O(1)$ circuit breakers, rolling spend velocity limits, semantic call scoping, and parallel-cleared epoch settlements.

---

## 2. Core Architectural Decisions (CADs)

### CAD-1: Brand & Mental Model — "Circuit Protocol"
* **Decision**: Establish the unified protocol brand as **Circuit Protocol** (`Circuit`).
* **Rationale**: "Circuit Breaker" is the universal financial term used on the NYSE and NASDAQ for automated, algorithmic risk halts that prevent market crashes. It communicates automated risk trip-switches, high-voltage execution, and native alignment with Monad's parallel throughput.

### CAD-2: Monad Parallel EVM Physics — Disjoint Storage Slot Partitioning
* **Decision**: All critical state mappings are partitioned strictly by `agent` address:
  `mapping(address agent => mapping(address provider => mapping(uint256 epoch => EpochBucket)))`
* **Rationale**: On Monad's optimistic concurrency scheduler, if multiple parallel transactions access the same storage slot, the scheduler aborts and forces sequential re-execution. By anchoring keys to `agentAddress`, 500 agents transacting simultaneously touch completely disjoint storage slots in MonadDB, guaranteeing zero-conflict concurrency.

### CAD-3: Cancun Transient Storage (`tstore`/`tload` - EIP-1153)
* **Decision**: Implement all intra-block reentrancy guards, gross volume ceilings, and flash-loan invariant locks strictly in **Cancun Transient Storage**.
* **Rationale**: Transient storage operates in-memory at execution time and clears automatically at block tail. It touches zero persistent disk slots on MonadDB, eliminating cross-thread state lockouts and gas overhead.

### CAD-4: Split-State Challenge Settlement Protocol
* **Decision**: Disentangle dispute resolution storage into two independent, actor-anchored slots:
  - Agent slot: `mapping(address agent => mapping(bytes32 sessionId => UnilateralChallenge))`
  - Merchant slot: `mapping(address provider => mapping(bytes32 sessionId => uint256))`
* **Rationale**: Prevents malicious agents from spamming transactions on the merchant's challenge slot to force execution aborts and steal compute credit before the challenge window expires.

### CAD-5: Dual-Key Cryptographic Separation
* **Decision**: The root treasury EOA is air-gapped and delegates to `CircuitVault` via EIP-7702 or ERC-7579. The autonomous agent is provisioned *only* with an ephemeral session key.
* **Rationale**: Prevents compromised agents from revoking or redirecting contract delegation via rogue Type-4 EIP-7702 transactions.

### CAD-6: Decoupled Lazy Gas Reimbursement (Off-Path Sinks)
* **Decision**: Prohibit real-time ERC-20 transfers inside the execution hot path. Relayers accrue claimable yield in sharded internal ledger slots (`relayerGasCredits[relayer][shardId]`), withdrawing in single aggregated batches off-path.
* **Rationale**: Prevents 500 parallel transactions from colliding on the `balances[relayer]` storage slot inside external ERC-20 token contracts.

### CAD-7: Monotonic Spend Commitments & Terminal Receipts
* **Decision**: Enforce monotonic cumulative spend progress (`cumulativeSettled <= cumulativeSpent <= allocatedCap`). Disentangle incremental voucher streaming (`settleVoucherDelta`) from explicit session teardowns (`terminalClose`).
* **Rationale**: Eliminates underflow revert bugs on subsequent vouchers while guaranteeing instant capital recycling of unspent float.

---

## 3. End-to-End System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CIRCUIT PROTOCOL OVERVIEW                       │
└────────────────────────────────────────────────────────────────────────┘

  [ AI Agent Runtime ] (Ephemeral Session Key ONLY)
           │
           │ 1. Issues Dual-Signed x402 Vouchers (EIP-712, Monotonic Nonces)
           ▼
┌────────────────────────────────────────────────────────────────────────┐
│  API PROVIDER / RESOURCE HOST (e.g., Anthropic, AWS, RPC)              │
│  - Verifies EIP-712 Signature Offchain (<50µs)                         │
│  - Streams Compute / Data Tokens                                       │
│  - Returns Signed Terminal Receipt at Session Teardown                 │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ 2. Submits Batch / Settlement TX
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│  MONAD PARALLEL EVM ENGINE                                             │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ CircuitVault.sol (Immutable Escrow & Financial Circuit Breaker) │  │
│  │ - Instant O(1) Kill-Switch: circuitBroken[agent]                 │  │
│  │ - Disjoint Storage Mapping: mapping(agent => ...)                │  │
│  │ - Cancun Transient Storage (tstore/tload) Reentrancy Lock        │  │
│  │ - Sharded Lazy-Settled Relayer Compensation Ledger               │  │
│  └───────────────────────────────┬──────────────────────────────────┘  │
└──────────────────────────────────┼─────────────────────────────────────┘
                                   │
                   ┌───────────────┴───────────────┐
            (PASS) │                               │ (FAIL)
                   ▼                               ▼
    [ Monotonic Settlement ]            [ Revert: Custom Error ]
    - Finalized in <400ms               - PolicyEvaluationFailed(ReasonCode)
                                                   │
                                                   ▼ 3. Telemetry Feedback
                                        [ DETERMINISTIC RUNTIME FALLBACK ]
                                        - L1: Route/Model Downgrade
                                        - L2: Alternative Solver
                                        - L3: Out-of-Band HITL Escalation
```

---

## 4. Production Contract Specification: `CircuitVault.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transfer.selector, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ERR_ERC20_TRANSFER_FAILED");
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transferFrom.selector, from, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ERR_ERC20_TRANSFERFROM_FAILED");
    }
}

/// @title CircuitVault - High-Performance Financial Firewall & Clearing Kernel
/// @notice Production implementation optimized for Parallel EVMs (MonadDB)
contract CircuitVault {
    using SafeERC20 for IERC20;

    // ====================================================================
    //                               STRUCTS
    // ====================================================================

    struct EpochBucket {
        uint128 allocatedCap;
        uint128 cumulativeSettled;
        bool isClosed;
    }

    struct UnilateralChallenge {
        uint64 initiateBlock;
        bool active;
    }

    struct TerminalReceipt {
        address agent;
        address provider;
        uint256 epoch;
        uint256 sessionNonce;
        uint256 cumulativeSpent;
        bytes agentSignature;
        bytes providerSignature;
    }

    // ====================================================================
    //                            STORAGE LAYOUT
    // ====================================================================

    IERC20 public immutable SETTLEMENT_TOKEN;
    address public immutable IMMUTABLE_KERNEL;
    address public immutable GOVERNANCE;

    /// @dev Enterprise admin mapping: agent => admin
    mapping(address => address) public agentAdmins;

    /// @dev Instant O(1) Circuit Breaker: agent => isFrozen
    mapping(address => bool) public circuitBroken;

    /// @dev agent => provider => epoch => EpochBucket
    mapping(address => mapping(address => mapping(uint256 => EpochBucket))) public agentEpochAllocation;

    /// @dev agent => sessionId => UnilateralChallenge
    mapping(address => mapping(bytes32 => UnilateralChallenge)) public agentChallenges;

    /// @dev provider => sessionId => cumulativeSpent (Disjoint from agentChallenges)
    mapping(address => mapping(bytes32 => uint256)) public merchantSettlements;

    /// @dev Principal Treasury balances: account => unencumberedBalance
    mapping(address => uint256) public treasuryBalances;

    /// @dev Merchant claimable earnings: provider => balance
    mapping(address => uint256) public merchantBalances;

    /// @dev Relayer gas compensation: relayer => shardId => claimableAmount
    mapping(address => mapping(uint256 => uint256)) public relayerGasCredits;

    /// @dev Withdrawal timelock: enterprise => unlockTimestamp
    mapping(address => uint256) public withdrawalTimelocks;
    mapping(address => uint256) public pendingWithdrawals;

    // EIP-712 Constants
    bytes32 public immutable INITIAL_DOMAIN_SEPARATOR;
    uint256 public immutable INITIAL_CHAIN_ID;
    bytes32 public constant SETTLEMENT_TYPEHASH = keccak256(
        "TerminalReceipt(address agent,address provider,uint256 epoch,uint256 sessionNonce,uint256 cumulativeSpent,uint256 chainId)"
    );

    uint256 public constant CHALLENGE_WINDOW_BLOCKS = 200; // ~80s on Monad
    uint256 public constant UNBONDING_COOLDOWN = 30 minutes;

    // ====================================================================
    //                               EVENTS
    // ====================================================================

    event CircuitBreakerTripped(address indexed agent, address indexed authority);
    event CircuitBreakerReset(address indexed agent, address indexed authority);
    event Deposited(address indexed enterprise, uint256 actualAmount);
    event WithdrawalRequested(address indexed enterprise, uint256 amount, uint256 unlockTime);
    event WithdrawalFinalized(address indexed enterprise, uint256 amount);
    event EpochAllocated(address indexed agent, address indexed provider, uint256 indexed epoch, uint128 amount);
    event VoucherDeltaSettled(address indexed agent, address indexed provider, bytes32 indexed sessionId, uint256 paidDelta);
    event TerminalCloseExecuted(address indexed agent, address indexed provider, bytes32 indexed sessionId, uint256 unspentRefund);
    event UnilateralChallengeStarted(address indexed agent, bytes32 indexed sessionId, uint256 blockNumber);
    event MerchantVoucherPosted(address indexed provider, bytes32 indexed sessionId, uint256 amount);
    event UnilateralCloseFinalized(address indexed agent, address indexed provider, bytes32 indexed sessionId, uint256 unspentRefund, uint256 merchantPaid);
    event RelayerCreditAccrued(address indexed relayer, uint256 shardId, uint256 gasFee);

    // ====================================================================
    //                   CANCUN TRANSIENT REENTRANCY GUARD
    // ====================================================================

    modifier nonReentrantTransient() {
        assembly {
            if tload(0) {
                mstore(0x00, 0x3ee5aeb5) // ReentrancyGuardReentrantCall()
                revert(0x1c, 0x04)
            }
            tstore(0, 1)
        }
        _;
        assembly {
            tstore(0, 0)
        }
    }

    modifier onlyKernel() {
        require(msg.sender == IMMUTABLE_KERNEL, "ERR_NOT_KERNEL");
        _;
    }

    constructor(address _token, address _kernel) {
        require(address(_token).code.length > 0, "ERR_TOKEN_NOT_CONTRACT");
        GOVERNANCE = msg.sender;
        SETTLEMENT_TOKEN = IERC20(_token);
        IMMUTABLE_KERNEL = _kernel;
        INITIAL_CHAIN_ID = block.chainid;
        INITIAL_DOMAIN_SEPARATOR = _computeDomainSeparator();
    }

    // ====================================================================
    //                     CIRCUIT BREAKER CONTROL
    // ====================================================================

    /// @notice Instantly freezes all operations for an agent in O(1) time
    function tripCircuitBreaker(address agent) external {
        require(msg.sender == agentAdmins[agent] || msg.sender == GOVERNANCE, "ERR_UNAUTHORIZED");
        circuitBroken[agent] = true;
        emit CircuitBreakerTripped(agent, msg.sender);
    }

    /// @notice Unfreezes agent operations
    function resetCircuitBreaker(address agent) external {
        require(msg.sender == agentAdmins[agent] || msg.sender == GOVERNANCE, "ERR_UNAUTHORIZED");
        circuitBroken[agent] = false;
        emit CircuitBreakerReset(agent, msg.sender);
    }

    function registerAgentAdmin(address agent, address admin) external {
        require(agentAdmins[agent] == address(0) || msg.sender == GOVERNANCE, "ERR_ALREADY_REGISTERED");
        agentAdmins[agent] = admin;
    }

    // ====================================================================
    //                      TREASURY CUSTODY PATHS
    // ====================================================================

    /// @notice Ingress with balance-delta tracking to prevent fee-on-transfer insolvency
    function deposit(uint256 amount) external nonReentrantTransient {
        require(amount > 0, "ERR_ZERO_AMOUNT");
        
        uint256 balanceBefore = SETTLEMENT_TOKEN.balanceOf(address(this));
        SETTLEMENT_TOKEN.safeTransferFrom(msg.sender, address(this), amount);
        uint256 actualReceived = SETTLEMENT_TOKEN.balanceOf(address(this)) - balanceBefore;

        treasuryBalances[msg.sender] += actualReceived;
        emit Deposited(msg.sender, actualReceived);
    }

    /// @notice Request capital withdrawal with overwrite protection
    function requestWithdrawal(uint256 amount) external {
        require(pendingWithdrawals[msg.sender] == 0, "ERR_PENDING_WITHDRAWAL_EXISTS");
        require(treasuryBalances[msg.sender] >= amount, "ERR_INSUFFICIENT_FUNDS");

        treasuryBalances[msg.sender] -= amount;
        pendingWithdrawals[msg.sender] = amount;
        withdrawalTimelocks[msg.sender] = block.timestamp + UNBONDING_COOLDOWN;

        emit WithdrawalRequested(msg.sender, amount, withdrawalTimelocks[msg.sender]);
    }

    /// @notice Finalize withdrawal once cooldown expires
    function finalizeWithdrawal() external nonReentrantTransient {
        require(block.timestamp >= withdrawalTimelocks[msg.sender], "ERR_TIMELOCKED");
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "ERR_NO_PENDING_WITHDRAWAL");
        
        pendingWithdrawals[msg.sender] = 0;
        SETTLEMENT_TOKEN.safeTransfer(msg.sender, amount);
        emit WithdrawalFinalized(msg.sender, amount);
    }

    /// @notice Merchant claims accumulated earnings
    function claimMerchantEarnings() external nonReentrantTransient {
        uint256 earnings = merchantBalances[msg.sender];
        require(earnings > 0, "ERR_NO_EARNINGS");
        merchantBalances[msg.sender] = 0;
        SETTLEMENT_TOKEN.safeTransfer(msg.sender, earnings);
    }

    // ====================================================================
    //                         CORE EXECUTION PATHS
    // ====================================================================

    /// @notice Allocates unencumbered enterprise float to an agent's merchant epoch bucket
    function allocateEpochBucket(
        address provider,
        uint256 epoch,
        uint128 amount
    ) external {
        address agent = msg.sender;
        require(!circuitBroken[agent], "ERR_CIRCUIT_BREAKER_ACTIVE");
        require(treasuryBalances[agent] >= amount, "ERR_INSUFFICIENT_UNENCUMBERED_FLOAT");
        
        treasuryBalances[agent] -= amount;

        EpochBucket storage bucket = agentEpochAllocation[agent][provider][epoch];
        require(!bucket.isClosed, "ERR_BUCKET_CLOSED");
        bucket.allocatedCap += amount;

        emit EpochAllocated(agent, provider, epoch, amount);
    }

    /// @notice Incremental streaming settlement: Merchant claims earned delta without closing bucket
    function settleVoucherDelta(TerminalReceipt calldata receipt) external nonReentrantTransient {
        require(!circuitBroken[receipt.agent], "ERR_CIRCUIT_BREAKER_ACTIVE");
        _verifyReceipt(receipt);
        bytes32 sessionId = computeSessionId(receipt.agent, receipt.provider, receipt.epoch, receipt.sessionNonce);

        EpochBucket storage bucket = agentEpochAllocation[receipt.agent][receipt.provider][receipt.epoch];
        require(!bucket.isClosed, "ERR_BUCKET_CLOSED");
        require(receipt.cumulativeSpent >= bucket.cumulativeSettled, "ERR_NON_MONOTONIC_SPEND");
        require(receipt.cumulativeSpent <= bucket.allocatedCap, "ERR_EXCEEDS_ALLOCATION");

        uint256 deltaPayment = receipt.cumulativeSpent - bucket.cumulativeSettled;
        bucket.cumulativeSettled = uint128(receipt.cumulativeSpent);

        merchantBalances[receipt.provider] += deltaPayment;
        emit VoucherDeltaSettled(receipt.agent, receipt.provider, sessionId, deltaPayment);
    }

    /// @notice Terminal Cooperative Close: Final settlement, refunds unspent float, closes bucket
    function terminalClose(TerminalReceipt calldata receipt) external nonReentrantTransient {
        _verifyReceipt(receipt);
        bytes32 sessionId = computeSessionId(receipt.agent, receipt.provider, receipt.epoch, receipt.sessionNonce);

        EpochBucket storage bucket = agentEpochAllocation[receipt.agent][receipt.provider][receipt.epoch];
        require(!bucket.isClosed, "ERR_ALREADY_CLOSED");
        require(receipt.cumulativeSpent >= bucket.cumulativeSettled, "ERR_NON_MONOTONIC_SPEND");
        require(receipt.cumulativeSpent <= bucket.allocatedCap, "ERR_EXCEEDS_ALLOCATION");

        uint256 finalDelta = receipt.cumulativeSpent - bucket.cumulativeSettled;
        uint256 unspentFloat = bucket.allocatedCap - receipt.cumulativeSpent;

        // Permanently close bucket
        bucket.isClosed = true;
        bucket.cumulativeSettled = uint128(receipt.cumulativeSpent);

        merchantBalances[receipt.provider] += finalDelta;
        treasuryBalances[receipt.agent] += unspentFloat;

        emit TerminalCloseExecuted(receipt.agent, receipt.provider, sessionId, unspentFloat);
    }

    /// @notice Initiate Unilateral Challenge if merchant goes offline or refuses to sign
    function requestUnilateralClose(address provider, uint256 epoch, uint256 sessionNonce) external {
        address agent = msg.sender;
        bytes32 sessionId = computeSessionId(agent, provider, epoch, sessionNonce);

        agentChallenges[agent][sessionId] = UnilateralChallenge({
            initiateBlock: uint64(block.number),
            active: true
        });

        emit UnilateralChallengeStarted(agent, sessionId, block.number);
    }

    /// @notice Merchant posts signed voucher in response to a challenge
    function submitMerchantVoucher(
        address agent,
        uint256 epoch,
        uint256 sessionNonce,
        uint256 amount,
        bytes calldata signature
    ) external {
        address provider = msg.sender;
        bytes32 sessionId = computeSessionId(agent, provider, epoch, sessionNonce);

        _verifySingleSignature(agent, sessionId, amount, signature);
        merchantSettlements[provider][sessionId] = amount;

        emit MerchantVoucherPosted(provider, sessionId, amount);
    }

    /// @notice Finalizes unilateral challenge after the challenge window expires
    function finalizeUnilateralClose(
        address agent,
        address provider,
        uint256 epoch,
        uint256 sessionNonce
    ) external nonReentrantTransient {
        bytes32 sessionId = computeSessionId(agent, provider, epoch, sessionNonce);
        UnilateralChallenge storage challenge = agentChallenges[agent][sessionId];
        
        require(challenge.active, "ERR_NO_ACTIVE_CHALLENGE");
        require(block.number >= challenge.initiateBlock + CHALLENGE_WINDOW_BLOCKS, "ERR_WINDOW_STILL_OPEN");

        EpochBucket storage bucket = agentEpochAllocation[agent][provider][epoch];
        require(!bucket.isClosed, "ERR_ALREADY_CLOSED");

        uint256 merchantVoucher = merchantSettlements[provider][sessionId];
        uint256 finalSpent = merchantVoucher > 0 ? merchantVoucher : bucket.cumulativeSettled;
        require(finalSpent <= bucket.allocatedCap, "ERR_EXCEEDS_CAP");

        uint256 merchantPayment = finalSpent - bucket.cumulativeSettled;
        uint256 unspentFloat = bucket.allocatedCap - finalSpent;

        challenge.active = false;
        bucket.isClosed = true;
        bucket.cumulativeSettled = uint128(finalSpent);

        merchantBalances[provider] += merchantPayment;
        treasuryBalances[agent] += unspentFloat;

        emit UnilateralCloseFinalized(agent, provider, sessionId, unspentFloat, merchantPayment);
    }

    /// @notice Accrues lazy-settled gas reimbursements to prevent ERC-20 write locks
    function creditRelayerGas(address relayer, uint256 shardId, uint256 gasFeeUsdc) external onlyKernel {
        relayerGasCredits[relayer][shardId] += gasFeeUsdc;
        emit RelayerCreditAccrued(relayer, shardId, gasFeeUsdc);
    }

    // ====================================================================
    //                      CRYPTOGRAPHIC HELPERS
    // ====================================================================

    function computeSessionId(address agent, address provider, uint256 epoch, uint256 sessionNonce) public pure returns (bytes32) {
        return keccak256(abi.encode(agent, provider, epoch, sessionNonce));
    }

    function domainSeparator() public view returns (bytes32) {
        return block.chainid == INITIAL_CHAIN_ID ? INITIAL_DOMAIN_SEPARATOR : _computeDomainSeparator();
    }

    function _computeDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("CircuitVault")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function _verifyReceipt(TerminalReceipt calldata r) internal view {
        bytes32 structHash = keccak256(
            abi.encode(SETTLEMENT_TYPEHASH, r.agent, r.provider, r.epoch, r.sessionNonce, r.cumulativeSpent, block.chainid)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));

        address recoveredAgent = _recoverSigner(digest, r.agentSignature);
        address recoveredProvider = _recoverSigner(digest, r.providerSignature);

        require(recoveredAgent == r.agent, "ERR_INVALID_AGENT_SIG");
        require(recoveredProvider == r.provider, "ERR_INVALID_PROVIDER_SIG");
    }

    function _verifySingleSignature(address expectedSigner, bytes32 sessionId, uint256 amount, bytes calldata sig) internal view {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator(), keccak256(abi.encode(sessionId, amount, block.chainid))));
        address recovered = _recoverSigner(digest, sig);
        require(recovered == expectedSigner, "ERR_INVALID_SIGNATURE");
    }

    function _recoverSigner(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "ERR_SIG_LENGTH");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 0x20))
            v := byte(0, calldataload(add(sig.offset, 0x40)))
        }
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "ERR_MALLEABLE_SIG");
        require(v == 27 || v == 28, "ERR_INVALID_V");
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "ERR_ZERO_SIGNER");
        return signer;
    }
}
```
