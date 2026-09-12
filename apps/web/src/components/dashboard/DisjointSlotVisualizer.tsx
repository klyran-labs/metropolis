import React from 'react';
import { formatEther } from 'viem';
import { Database, Cpu, Layers, Info } from 'lucide-react';
import { type AgentSpendState } from '@agentguard/shared-types';

interface DisjointSlotVisualizerProps {
  state: AgentSpendState;
  agentAddress?: string;
  compact?: boolean;
}

/**
 * Packs the runtime spend state into a 32-byte hex representation matching PolicyEngine.sol:
 * - Bits 0..127   (16 bytes): spentInWindow (uint128)
 * - Bits 128..159 (4 bytes):  windowStart (uint32)
 * - Bits 160..191 (4 bytes):  txCountInWindow (uint32)
 * - Bits 192..255 (8 bytes):  nonce (uint64)
 */
export function computePackedSlotHex(state: AgentSpendState): string {
  const spentHex = state.spentInWindow.toString(16).padStart(32, '0'); // 16 bytes = 32 hex chars
  const windowStartHex = (Number(state.windowStart) >>> 0).toString(16).padStart(8, '0'); // 4 bytes = 8 hex chars
  const txCountHex = (state.txCountInWindow >>> 0).toString(16).padStart(8, '0'); // 4 bytes = 8 hex chars
  const nonceHex = state.nonce.toString(16).padStart(16, '0'); // 8 bytes = 16 hex chars
  return `0x${nonceHex}${txCountHex}${windowStartHex}${spentHex}`;
}

export const DisjointSlotVisualizer: React.FC<DisjointSlotVisualizerProps> = ({
  state,
  agentAddress,
  compact = false,
}) => {
  const packedSlotHex = computePackedSlotHex(state);
  const spentMon = formatEther(state.spentInWindow);
  const windowStartDate = Number(state.windowStart) > 0
    ? new Date(Number(state.windowStart) * 1000).toLocaleTimeString()
    : 'Not Started';

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-slate-900 p-5 text-white shadow-xs dark:border-slate-800">
      <div className="flex flex-col space-y-1 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
        <div className="flex items-center space-x-2">
          <Database className="h-4 w-4 text-blue-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Monad Parallel EVM: Disjoint Storage Slot Packing
          </h3>
        </div>
        <div className="flex items-center space-x-2 text-[11px] font-mono text-emerald-400">
          <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Single 32-Byte Word (Zero OCC Aborts)</span>
        </div>
      </div>

      {!compact && (
        <p className="mt-2 text-xs text-slate-400 leading-relaxed">
          Monad Parallel EVM evaluates transactions concurrently. Packing policy spend states strictly by agent into a single 32-byte storage slot eliminates cross-thread write-lock contention.
        </p>
      )}

      {/* Bit Packing Schema Grid */}
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {/* spentInWindow: 128 bits */}
        <div className="rounded-xl border border-blue-500/30 bg-blue-950/40 p-3">
          <div className="flex items-center justify-between text-[10px] text-blue-300">
            <span className="font-mono font-bold">uint128</span>
            <span className="font-mono">Bits 0..127</span>
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-400">spentInWindow</p>
          <p className="mt-0.5 font-mono text-sm font-bold text-white truncate" title={`${spentMon} MON`}>
            {spentMon} <span className="text-[10px] font-normal text-blue-300">MON</span>
          </p>
        </div>

        {/* windowStart: 32 bits */}
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-3">
          <div className="flex items-center justify-between text-[10px] text-emerald-300">
            <span className="font-mono font-bold">uint32</span>
            <span className="font-mono">Bits 128..159</span>
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-400">windowStart</p>
          <p className="mt-0.5 font-mono text-sm font-bold text-white truncate" title={windowStartDate}>
            {windowStartDate}
          </p>
        </div>

        {/* txCountInWindow: 32 bits */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/40 p-3">
          <div className="flex items-center justify-between text-[10px] text-amber-300">
            <span className="font-mono font-bold">uint32</span>
            <span className="font-mono">Bits 160..191</span>
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-400">txCountInWindow</p>
          <p className="mt-0.5 font-mono text-sm font-bold text-white">
            {state.txCountInWindow} <span className="text-[10px] font-normal text-amber-300">txs</span>
          </p>
        </div>

        {/* nonce: 64 bits */}
        <div className="rounded-xl border border-purple-500/30 bg-purple-950/40 p-3">
          <div className="flex items-center justify-between text-[10px] text-purple-300">
            <span className="font-mono font-bold">uint64</span>
            <span className="font-mono">Bits 192..255</span>
          </div>
          <p className="mt-1 text-[11px] font-medium text-slate-400">nonce</p>
          <p className="mt-0.5 font-mono text-sm font-bold text-white">
            #{state.nonce.toString()}
          </p>
        </div>
      </div>

      {/* Raw Storage Word Representation */}
      <div className="mt-4 rounded-xl border border-slate-800 bg-black/50 p-3">
        <div className="flex items-center justify-between text-[10px] text-slate-400">
          <span>Raw EVM Storage Slot Value (32 Bytes):</span>
          {agentAddress && (
            <span className="font-mono text-[10px] text-blue-400">
              Key: keccak256({agentAddress.slice(0, 10)}... || POLICY_SLOT)
            </span>
          )}
        </div>
        <p className="mt-1 font-mono text-[11px] text-emerald-400 break-all select-all">
          {packedSlotHex}
        </p>
      </div>
    </div>
  );
};
