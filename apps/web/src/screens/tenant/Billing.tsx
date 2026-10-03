import { useWallets } from "@privy-io/react-auth";
import { useState } from "react";
import { encodeFunctionData, parseAbi } from "viem";
import { configuration } from "../../configuration";
import { request, toUserFacingError, useSubscription, usePlans, type Checkout } from "../../api";
import {
  Badge,
  Button,
  EmptyState,
  RecordSummary,
  Surface,
  TokenAmount,
  TransactionStatus,
  type TransactionPhase,
} from "../../design-system";
import { useIdentity } from "../../identity";

async function waitForReceipt(
  provider: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> },
  transactionHash: string,
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [transactionHash],
    })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status === "0x0") {
        throw new Error("The payment was rejected.");
      }
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 750));
  }
  throw new Error("The payment took too long to confirm. Try again.");
}

export function Billing() {
  const identity = useIdentity();
  const subscription = useSubscription(Boolean(identity.authenticated));
  const plans = usePlans(Boolean(identity.authenticated));
  const { wallets } = useWallets();
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const [transactionPhase, setTransactionPhase] = useState<TransactionPhase>("idle");
  const [transactionHash, setTransactionHash] = useState<string>();
  const [transactionError, setTransactionError] = useState("");
  const settle = async (planPriceId: string) => {
    const wallet = wallets[0];
    const guard = configuration.contracts.agentWalletGuard;
    if (!wallet || !guard) {
      setMessage("Connect a wallet before subscribing.");
      return;
    }
    setWorking(true);
    setTransactionPhase("awaiting_wallet");
    setTransactionHash(undefined);
    setTransactionError("");
    setMessage("Preparing your payment…");
    try {
      const checkout = await request<Checkout>("/subscription/checkout", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ planPriceId, agent: wallet.address }),
      });
      const provider = await wallet.getEthereumProvider();
      const payment = checkout.settlement.request;
      const typedData = {
        domain: {
          name: "AgentGuard_PolicyEngine",
          version: "1",
          chainId: checkout.settlement.chainId,
          verifyingContract: guard,
        },
        types: {
          SpendRequest: [
            { name: "agent", type: "address" },
            { name: "merchant", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "category", type: "bytes32" },
            { name: "timestamp", type: "uint256" },
            { name: "deadline", type: "uint256" },
            { name: "nonce", type: "uint256" },
          ],
        },
        primaryType: "SpendRequest",
        message: payment,
      };
      const signature = (await provider.request({
        method: "eth_signTypedData_v4",
        params: [wallet.address, JSON.stringify(typedData)],
      })) as string;
      const approveData = encodeFunctionData({
        abi: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]),
        functionName: "approve",
        args: [guard, BigInt(payment.amount)],
      });
      const approvalHash = (await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: wallet.address, to: checkout.settlement.tokenAddress, data: approveData }],
      })) as string;
      setTransactionHash(approvalHash);
      setTransactionPhase("pending");
      await waitForReceipt(provider, approvalHash);
      const executeData = encodeFunctionData({
        abi: parseAbi([
          "function executeGatedPayment((address agent,address merchant,uint256 amount,bytes32 category,uint256 timestamp,uint256 deadline,uint256 nonce) req, bytes signature, address token, bytes extraCallData) returns (bool success)",
        ]),
        functionName: "executeGatedPayment",
        args: [
          {
            agent: payment.agent as `0x${string}`,
            merchant: payment.merchant as `0x${string}`,
            amount: BigInt(payment.amount),
            category: payment.category as `0x${string}`,
            timestamp: BigInt(payment.timestamp),
            deadline: BigInt(payment.deadline),
            nonce: BigInt(payment.nonce),
          },
          signature as `0x${string}`,
          checkout.settlement.tokenAddress as `0x${string}`,
          "0x",
        ],
      });
      const transactionHash = (await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: wallet.address, to: guard, data: executeData }],
      })) as string;
      setTransactionHash(transactionHash);
      setTransactionPhase("pending");
      await waitForReceipt(provider, transactionHash);
      await request(`/billing/payments/${checkout.paymentId}/submit`, {
        method: "POST",
        body: JSON.stringify({ transactionHash }),
      });
      setTransactionPhase("confirmed");
      setMessage("Payment submitted. Your subscription will activate once it's confirmed.");
      void subscription.refetch();
    } catch (error) {
      const safeError = toUserFacingError(error, "The payment could not be completed.");
      setTransactionPhase("failed");
      setTransactionError(safeError);
      setMessage(safeError);
    } finally {
      setWorking(false);
    }
  };
  return (
    <div className="stack">
      <header className="page-heading">
        <div>
          <h1>Billing & Subscription</h1>
          <p>Manage your subscription plan and payment receipts.</p>
        </div>
      </header>
      <Surface>
        {message && <p className="form-message">{message}</p>}
        {plans.isError ? (
          <EmptyState title="Plans unavailable" detail="We couldn't load the plan catalog right now." />
        ) : plans.data?.length ? (
          <div className="pricing-cards">
            {plans.data.flatMap((plan) =>
              plan.prices.map((price) => (
                <div className="pricing-card" key={price.id}>
                  <span className="card-kicker">{plan.code}</span>
                  <strong>{plan.name}</strong>
                  <p>{plan.description}</p>
                  <div className="pricing-amount">
                    <TokenAmount baseUnits={price.amountBaseUnits} />
                    <small> / {price.interval}</small>
                  </div>
                  <Button onClick={() => void settle(price.id)} disabled={working}>
                    Subscribe
                  </Button>
                </div>
              )),
            )}
          </div>
        ) : (
          <EmptyState
            title="No plans available yet"
            detail="An administrator needs to publish a plan before you can subscribe."
          />
        )}
      </Surface>
      <TransactionStatus phase={transactionPhase} hash={transactionHash} error={transactionError} />
      <Surface>
        <div className="section-heading">
          <h2>Current Subscription</h2>
          {subscription.data?.subscription && (
            <Badge tone="success">{String(subscription.data.subscription.status ?? "recorded")}</Badge>
          )}
        </div>
        {subscription.isError ? (
          <EmptyState
            title="Subscription unavailable"
            detail="We couldn't load your subscription right now."
          />
        ) : subscription.data?.subscription ? (
          <RecordSummary record={subscription.data.subscription} />
        ) : (
          <EmptyState
            title="No subscription"
            detail="An administrator needs to publish a plan before you can subscribe."
          />
        )}
      </Surface>
    </div>
  );
}
