/**
 * AgentGuard Autonomous Multi-Tier Circuit Breaker Engine
 * State Machine: CLOSED (Armored) -> OPEN (Tripped) -> HALF_OPEN (Trial Probe)
 * Automatically halts runaway recursive loops in O(1) time before cascading financial loss.
 */

import { type CircuitBreakerConfig, ReasonCode } from '@agentguard/shared-types';

export const DEFAULT_FAILURE_THRESHOLD = 3;
export const DEFAULT_COOL_OFF_SECONDS = 900; // 15 minutes

/**
 * Creates a default healthy CircuitBreakerConfig
 */
export function createDefaultCircuitBreaker(
  failureThreshold = DEFAULT_FAILURE_THRESHOLD,
  coolOffSeconds = DEFAULT_COOL_OFF_SECONDS
): CircuitBreakerConfig {
  return {
    status: 'CLOSED',
    failureThreshold,
    coolOffSeconds,
    consecutiveFailures: 0,
  };
}

export interface CircuitBreakerEvaluationResult {
  config: CircuitBreakerConfig;
  stateChanged: boolean;
  tripped: boolean;
}

/**
 * Evaluates an onchain or gateway policy outcome against the circuit breaker state.
 * Returns the updated configuration and whether a state transition / trip occurred.
 */
export function recordEvaluation(
  currentConfig: CircuitBreakerConfig,
  allowed: boolean,
  reasonCode: ReasonCode = ReasonCode.ERR_NONE,
  timestamp: number = Math.floor(Date.now() / 1000)
): CircuitBreakerEvaluationResult {
  const config: CircuitBreakerConfig = { ...currentConfig };

  if (allowed) {
    if (config.status === 'HALF_OPEN') {
      // Successful trial probe recovers the circuit breaker to CLOSED
      config.status = 'CLOSED';
      config.consecutiveFailures = 0;
      config.trippedAt = undefined;
      config.reason = undefined;
      return { config, stateChanged: true, tripped: false };
    }

    if (config.status === 'CLOSED') {
      // Normal successful execution keeps failure counter at zero
      config.consecutiveFailures = 0;
      return { config, stateChanged: false, tripped: false };
    }

    return { config, stateChanged: false, tripped: false };
  }

  // Denied / Rejected transaction
  config.consecutiveFailures = (config.consecutiveFailures || 0) + 1;
  config.lastFailureTimestamp = timestamp;

  if (config.status === 'HALF_OPEN') {
    // Rejection during trial probe immediately returns to OPEN
    config.status = 'OPEN';
    config.trippedAt = timestamp;
    config.reason = `Trial probe rejected with reason code ${reasonCode}. Circuit re-opened.`;
    return { config, stateChanged: true, tripped: true };
  }

  if (config.status === 'CLOSED') {
    if (config.consecutiveFailures >= config.failureThreshold) {
      // Auto-trip threshold exceeded! Quarantine agent immediately.
      config.status = 'OPEN';
      config.trippedAt = timestamp;
      config.reason = `Auto-tripped after ${config.consecutiveFailures} consecutive policy rejections (latest reason code: ${reasonCode}).`;
      return { config, stateChanged: true, tripped: true };
    }
  }

  return { config, stateChanged: false, tripped: false };
}

/**
 * Checks if an OPEN circuit breaker has cooled off and can transition to HALF_OPEN.
 */
export function checkCoolOffTransition(
  currentConfig: CircuitBreakerConfig,
  currentTimestamp: number = Math.floor(Date.now() / 1000)
): CircuitBreakerConfig {
  if (currentConfig.status !== 'OPEN') return currentConfig;

  const trippedAt = currentConfig.trippedAt || 0;
  const elapsed = currentTimestamp - trippedAt;

  if (elapsed >= currentConfig.coolOffSeconds) {
    return {
      ...currentConfig,
      status: 'HALF_OPEN',
      reason: 'Cool-down period completed. Trial probe enabled.',
    };
  }

  return currentConfig;
}

/**
 * Manually trips the circuit breaker into OPEN state (Supervisor override).
 */
export function tripCircuitBreaker(
  currentConfig: CircuitBreakerConfig,
  reason = 'Manually tripped by supervisor override',
  timestamp: number = Math.floor(Date.now() / 1000)
): CircuitBreakerConfig {
  return {
    ...currentConfig,
    status: 'OPEN',
    trippedAt: timestamp,
    reason,
  };
}

/**
 * Manually resets the circuit breaker into CLOSED state (Supervisor clearance).
 */
export function resetCircuitBreaker(currentConfig: CircuitBreakerConfig): CircuitBreakerConfig {
  return {
    ...currentConfig,
    status: 'CLOSED',
    consecutiveFailures: 0,
    trippedAt: undefined,
    reason: undefined,
  };
}
