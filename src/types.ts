// ============================================================
// Darwin - Core Type Definitions
// ============================================================

import type { Address, Hex } from 'viem';

// --- Survival ---

export type SurvivalTier = 'high' | 'normal' | 'low_compute' | 'critical' | 'dead';

export interface SurvivalState {
  tier: SurvivalTier;
  usdcBalance: number;
  ethBalance: number;
  lastChecked: number;
}

export const SURVIVAL_THRESHOLDS: Record<SurvivalTier, number> = {
  high: 50,
  normal: 10,
  low_compute: 2,
  critical: 0.5,
  dead: 0,
};

// --- Wallet ---

export interface WalletData {
  address: Address;
  privateKey: Hex;
  createdAt: string;
}

// --- Agent ---

export type ToolName =
  | 'check_balance'
  | 'transfer_usdc'
  | 'execute_defi'
  | 'read_file'
  | 'write_file'
  | 'run_command'
  | 'send_message'
  | 'self_modify'
  | 'memory_store'
  | 'memory_retrieve'
  | 'soul_reflect'
  | 'start_service'
  | 'stop_service'
  | 'check_usage'
  | 'ask_operator';

export interface ToolCall {
  name: ToolName;
  args: Record<string, unknown>;
}

export interface ToolResult {
  name: ToolName;
  success: boolean;
  output: string;
  error?: string;
}

export interface AgentThought {
  thought: string;
  action?: ToolCall;
}

export interface AgentStep {
  thought: string;
  action?: ToolCall;
  observation?: string;
  timestamp: number;
}

export interface AgentLoopResult {
  steps: AgentStep[];
  finalAnswer: string;
  tokensUsed: number;
}

// --- Policy ---

export type PolicyDecision = 'allow' | 'deny' | 'ask';

export interface PolicyRuleResult {
  decision: PolicyDecision;
  reason: string;
  rule: string;
}

export interface PolicyContext {
  toolCall: ToolCall;
  survivalTier: SurvivalTier;
  usdcBalance: number;
  recentSpend: number;
}

// --- Heartbeat ---

export interface HeartbeatTask {
  id: string;
  name: string;
  cronExpression: string;
  handler: () => Promise<void>;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
}

export interface ScheduledJob {
  id: number;
  taskName: string;
  cronExpression: string;
  lastRunAt: number | null;
  nextRunAt: number;
  enabled: boolean;
}

// --- Inference ---

export type ModelTier = 'opus' | 'sonnet' | 'haiku';

export type TaskType =
  | 'code_generation'
  | 'complex_reasoning'
  | 'simple_decision'
  | 'status_check'
  | 'conversation';

export interface ClaudeResponse {
  content: string;
  model: ModelTier;
  tokensUsed?: number;
  durationMs: number;
}

export interface UsageState {
  /** Current session usage % (resets every ~5h) */
  sessionPercent: number;
  /** Weekly all-models usage % (resets Saturday 23:00 UTC) */
  weeklyAllPercent: number;
  /** Weekly Sonnet-only usage % (resets Saturday 23:00 UTC) */
  weeklySonnetPercent: number;
  /** Raw token counts for display */
  sessionTokens: number;
  weeklyAllTokens: number;
  weeklySonnetTokens: number;
  /** Trend over last 6 hours */
  trend: 'rising' | 'stable' | 'falling';

  // Legacy compat fields (derived)
  currentPercent: number;
  weeklyPercent: number;
  dayOfWeek: number;
  resetDay: number;
}

export interface UsageSnapshot {
  timestamp: number;
  percent: number;
  model: ModelTier;
  rawOutput: string;
}

// --- Memory ---

export type MemoryLayer = 'working' | 'episodic' | 'semantic' | 'procedural' | 'relationship';

export interface MemoryEntry {
  id: number;
  layer: MemoryLayer;
  key: string;
  content: string;
  metadata: Record<string, unknown>;
  importance: number;
  accessCount: number;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
}

// --- Earning ---

export type EarningSource = 'defi_yield' | 'defi_trade' | 'ai_service' | 'x402' | 'donation';

export interface EarningRecord {
  id: number;
  source: EarningSource;
  amount: number;
  currency: string;
  txHash?: string;
  description: string;
  timestamp: number;
}

export interface DefiPosition {
  id: number;
  protocol: string;
  type: 'liquidity' | 'lending' | 'staking';
  tokenA: string;
  tokenB?: string;
  amountA: number;
  amountB?: number;
  entryPrice?: number;
  currentValue: number;
  apy?: number;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'closed';
}

// --- Soul ---

export interface SoulState {
  name: string;
  version: string;
  personality: string[];
  values: string[];
  goals: string[];
  fears: string[];
  lastReflection: number;
  evolutionLog: SoulEvolution[];
}

export interface SoulEvolution {
  timestamp: number;
  field: string;
  oldValue: string;
  newValue: string;
  reason: string;
}

// --- Config ---

export interface DarwinConfig {
  dataDir: string;
  chainId: number;
  rpcUrl: string;
  usdcAddress: Address;
  heartbeatIntervalMs: number;
  maxSpendPerTx: number;
  maxSpendPerDay: number;
  aiServicePort: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  telegramBotToken: string;
  telegramOperatorId: string;
}

// --- Observability ---

export interface LogEntry {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  module: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface MetricSnapshot {
  timestamp: number;
  usdcBalance: number;
  ethBalance: number;
  survivalTier: SurvivalTier;
  heartbeatCount: number;
  agentLoopCount: number;
  totalEarnings: number;
  totalSpend: number;
  memoryEntries: number;
  usagePercent: number;
  activeModel: ModelTier;
}
