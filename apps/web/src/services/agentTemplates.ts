/**
 * AgentGuard Workload Template Registry
 * Dynamic storage for enterprise agent blueprints with dual-denomination
 * (Tokens + MON) metering, category filtering, and Circuit Breaker parameters.
 */

export type WorkloadCategory = 'INFERENCE' | 'SCRAPING' | 'TRAINING' | 'DEFI' | 'DEVOPS';

export interface AgentWorkloadTemplate {
  id: string;
  name: string;
  role: string;
  category: WorkloadCategory;
  tokenQuota: string;             // e.g. "3,000,000 Tokens/wk"
  defaultMaxPerTx: string;        // In MON
  defaultMaxPerWindow: string;    // In MON
  defaultWindowSeconds: number;
  defaultVelocity: number;
  circuitBreakerThreshold: number; // e.g. 3 consecutive denials
  whitelistEnabled: boolean;
  description: string;
  isCustom?: boolean;
}

export const DEFAULT_WORKLOAD_TEMPLATES: AgentWorkloadTemplate[] = [
  {
    id: 'tpl_qwen_38_max',
    name: 'Alibaba Qwen 3.8 Max Autonomous Agent',
    role: 'Autonomous Reasoning & Synthesis',
    category: 'INFERENCE',
    tokenQuota: '3,000,000 Tokens/wk',
    defaultMaxPerTx: '0.10',
    defaultMaxPerWindow: '1.50',
    defaultWindowSeconds: 3600,
    defaultVelocity: 10,
    circuitBreakerThreshold: 3,
    whitelistEnabled: false,
    description: 'Executes high-level reasoning and research loops with real-time x402 Monad micro-settlements and automated circuit-breaker quarantine.',
  },
  {
    id: 'tpl_claude_inference',
    name: 'LLM Inference Agent (Claude 3.7 / R1)',
    role: 'Compute Procurement',
    category: 'INFERENCE',
    tokenQuota: '5,000,000 Tokens/wk',
    defaultMaxPerTx: '0.25',
    defaultMaxPerWindow: '2.0',
    defaultWindowSeconds: 3600,
    defaultVelocity: 5,
    circuitBreakerThreshold: 3,
    whitelistEnabled: false,
    description: 'Procures high-throughput GPU tokens per invocation under tight per-request caps.',
  },
  {
    id: 'tpl_web_scraper',
    name: 'Web Data Aggregator (Firecrawl)',
    role: 'Web Scraping & Extraction',
    category: 'SCRAPING',
    tokenQuota: '100,000 Pages/wk',
    defaultMaxPerTx: '0.10',
    defaultMaxPerWindow: '1.0',
    defaultWindowSeconds: 3600,
    defaultVelocity: 8,
    circuitBreakerThreshold: 3,
    whitelistEnabled: false,
    description: 'Executes rapid micro-payments for structured web scraping endpoints.',
  },
  {
    id: 'tpl_model_trainer',
    name: 'Synthetic Data & Model Trainer',
    role: 'Distributed Model Training',
    category: 'TRAINING',
    tokenQuota: '20,000,000 Tokens/wk',
    defaultMaxPerTx: '1.50',
    defaultMaxPerWindow: '8.0',
    defaultWindowSeconds: 7200,
    defaultVelocity: 12,
    circuitBreakerThreshold: 5,
    whitelistEnabled: true,
    description: 'High-volume batch compute workloads with strict merchant whitelist enforcement.',
  },
  {
    id: 'tpl_defi_arbitrage',
    name: 'DeFi Arbitrage & Execution Bot',
    role: 'Liquidity Optimization',
    category: 'DEFI',
    tokenQuota: 'Capacity Quota',
    defaultMaxPerTx: '0.50',
    defaultMaxPerWindow: '5.0',
    defaultWindowSeconds: 1800,
    defaultVelocity: 15,
    circuitBreakerThreshold: 2,
    whitelistEnabled: true,
    description: 'Sub-second flash execution on Monad DEXes with strict velocity throttling.',
  },
  {
    id: 'tpl_devops_sre',
    name: 'SRE & Cloud DevOps Autonomous Worker',
    role: 'Infrastructure Automation',
    category: 'DEVOPS',
    tokenQuota: '2,000,000 Tokens/wk',
    defaultMaxPerTx: '0.15',
    defaultMaxPerWindow: '1.20',
    defaultWindowSeconds: 3600,
    defaultVelocity: 6,
    circuitBreakerThreshold: 3,
    whitelistEnabled: true,
    description: 'Automates cloud provisioning and incident remediation under verified merchant whitelists.',
  },
];

const STORAGE_KEY = 'agentguard_workload_templates';

/**
 * Retrieves all templates from localStorage, or initializes defaults if not present.
 */
export function getAgentTemplates(): AgentWorkloadTemplate[] {
  if (typeof window === 'undefined') {
    return DEFAULT_WORKLOAD_TEMPLATES;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_WORKLOAD_TEMPLATES));
      return DEFAULT_WORKLOAD_TEMPLATES;
    }

    const parsed: AgentWorkloadTemplate[] = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_WORKLOAD_TEMPLATES));
      return DEFAULT_WORKLOAD_TEMPLATES;
    }

    return parsed;
  } catch {
    return DEFAULT_WORKLOAD_TEMPLATES;
  }
}

/**
 * Saves a new or updated template to localStorage.
 */
export function saveAgentTemplate(template: AgentWorkloadTemplate): AgentWorkloadTemplate[] {
  const current = getAgentTemplates();
  const existingIndex = current.findIndex((t) => t.id === template.id);

  let updated: AgentWorkloadTemplate[];
  if (existingIndex >= 0) {
    updated = [...current];
    updated[existingIndex] = template;
  } else {
    updated = [...current, template];
  }

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn('Failed to persist workload template to localStorage', e);
    }
  }

  return updated;
}

/**
 * Deletes a custom template by ID. Cannot delete built-in default templates.
 */
export function deleteAgentTemplate(id: string): AgentWorkloadTemplate[] {
  const current = getAgentTemplates();
  const target = current.find((t) => t.id === id);

  if (!target || !target.isCustom) {
    // Cannot delete system templates
    return current;
  }

  const filtered = current.filter((t) => t.id !== id);

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) {
      console.warn('Failed to update workload templates in localStorage', e);
    }
  }

  return filtered;
}

/**
 * Resets the template catalog to official default enterprise templates.
 */
export function resetAgentTemplatesToDefault(): AgentWorkloadTemplate[] {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_WORKLOAD_TEMPLATES));
    } catch (e) {
      console.warn('Failed to reset workload templates in localStorage', e);
    }
  }
  return DEFAULT_WORKLOAD_TEMPLATES;
}
