/**
 * Translates low-level EVM, Viem, RPC, Key Vault, and Auth exceptions into clean,
 * institutional, human-centric diagnostic messages with zero developer/infrastructure leaks.
 */

/**
 * Translates Web3 and onchain transaction errors into user-friendly diagnostic messages.
 */
export function formatWeb3ErrorMessage(error: any): string {
  if (!error) return 'Transaction failed on Monad.';
  const rawMessage = error?.shortMessage || error?.message || (typeof error === 'string' ? error : '');
  const message = rawMessage.toLowerCase();

  // 1. Gas, Balance & Fee Errors
  if (
    message.includes('exceeds the balance of the account') ||
    message.includes('insufficient funds') ||
    message.includes('insufficient balance') ||
    message.includes('gas * gas fee + value') ||
    message.includes('intrinsic gas too low')
  ) {
    return 'Insufficient MON in connected wallet to cover gas and transaction value. Please fund your account with MON on Monad to continue.';
  }

  // 2. User Cancellation
  if (
    message.includes('user rejected') ||
    message.includes('user denied') ||
    message.includes('denied transaction signature') ||
    message.includes('action_rejected') ||
    message.includes('cancelled by the user')
  ) {
    return 'Transaction was cancelled by the user.';
  }

  // 3. Network, RPC & Connectivity
  if (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('fetch failed') ||
    message.includes('connection refused') ||
    message.includes('connection reset') ||
    message.includes('err_connection') ||
    message.includes('socket hang up')
  ) {
    return 'Network connection failed. Unable to reach the Monad network RPC. Please verify your internet connection or network status.';
  }

  // 4. Rate Limits & Timeouts
  if (message.includes('429') || message.includes('too many requests') || message.includes('rate limit')) {
    return 'Network RPC rate limit reached. Please wait a moment and try again.';
  }

  if (message.includes('timed out') || message.includes('timeout') || message.includes('block not found')) {
    return 'Transaction confirmation timed out. Please check your transaction status on the Monad Explorer.';
  }

  // 5. Nonce Conflicts & Underpriced Transactions
  if (
    message.includes('nonce too low') ||
    message.includes('nonce_expired') ||
    message.includes('replacement transaction underpriced') ||
    message.includes('already known')
  ) {
    return 'Transaction nonce conflict or pending transaction in progress. Please refresh and retry.';
  }

  // 6. Chain / Network Mismatch
  if (message.includes('chainmismatch') || message.includes('wrong chain') || message.includes('chain id')) {
    return 'Connected wallet is on the wrong network. Please switch to Monad Testnet (Chain ID 10143).';
  }

  // 7. Revert Reasons
  if (message.includes('execution reverted')) {
    const reasonMatch = rawMessage.match(/reverted with reason string '([^']+)'/);
    if (reasonMatch && reasonMatch[1]) {
      return `Transaction reverted: ${reasonMatch[1]}`;
    }
    const customErrorMatch = rawMessage.match(/reverted with custom error '([^']+)'/);
    if (customErrorMatch && customErrorMatch[1]) {
      return `Transaction reverted: ${customErrorMatch[1]}`;
    }
    if (message.includes('ownableunauthorizedaccount') || message.includes('onlyadmin') || message.includes('unauthorized')) {
      return 'Action denied: Connected wallet does not possess operator authority for this contract.';
    }
    return 'Transaction execution reverted on Monad. The contract policy rejected the call.';
  }

  // 8. Sovereign Key Vault / Enclave
  if (message.includes('opensigner') || message.includes('enclave') || message.includes('vault')) {
    return 'Sovereign key vault service is unavailable. Please ensure the key vault service is active.';
  }

  // 9. Clean Viem Short Message Fallback
  if (error?.shortMessage && typeof error.shortMessage === 'string' && error.shortMessage.length < 120) {
    return error.shortMessage;
  }

  // 10. Fallback sanitization (strip raw stack traces, hex blobs, URLs, and keep first sentence)
  const cleaned = rawMessage
    .split('\n')[0]
    .replace(/http[s]?:\/\/\S+/g, '')
    .replace(/0x[a-fA-F0-9]{40,}/g, '')
    .replace(/:3001|:8545|:8080/g, '')
    .trim();

  return cleaned && cleaned.length > 0 && cleaned.length < 140
    ? cleaned
    : 'Transaction failed on Monad. Please check parameters and try again.';
}

/**
 * Translates authentication errors into clean, user-friendly diagnostic messages.
 */
export function formatAuthErrorMessage(error: any): string {
  if (!error) return 'Authentication failed. Please try again.';
  const rawMessage = error?.message || (typeof error === 'string' ? error : '');
  const lower = rawMessage.toLowerCase();

  if (lower.includes('invalid') && (lower.includes('code') || lower.includes('otp'))) {
    return 'Invalid or expired verification code. Please check your email and try again.';
  }
  if (lower.includes('rate limit') || lower.includes('too many')) {
    return 'Too many verification attempts. Please wait a moment before trying again.';
  }
  if (lower.includes('user rejected') || lower.includes('cancelled') || lower.includes('denied')) {
    return 'Wallet authentication was cancelled.';
  }
  if (lower.includes('network') || lower.includes('failed to fetch') || lower.includes('fetch failed')) {
    return 'Unable to reach authentication service. Please check your internet connection.';
  }

  const sanitized = rawMessage.replace(/\[Privy[^\]]*\]\s*/gi, '').trim();
  return sanitized && sanitized.length < 140 ? sanitized : 'Authentication failed. Please try again.';
}

/**
 * Translates Sovereign Key Vault service errors into clean domain messages.
 */
export function formatVaultErrorMessage(error: any): string {
  if (!error) return 'Sovereign key vault service is unavailable.';
  const rawMessage = error?.message || (typeof error === 'string' ? error : '');
  const lower = rawMessage.toLowerCase();

  if (lower.includes('wallet not found') || lower.includes('not found')) {
    return 'Agent keypair was not found in the sovereign key vault.';
  }
  if (lower.includes('unauthorized') || lower.includes('foreign address') || lower.includes('does not control')) {
    return 'Unauthorized signing request: Key vault does not control this agent address.';
  }
  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('refused') || lower.includes('timed out')) {
    return 'Sovereign key vault service is unavailable. Please ensure the key vault service is connected and running.';
  }

  return 'Failed to interact with sovereign key vault. Please verify vault connectivity.';
}
