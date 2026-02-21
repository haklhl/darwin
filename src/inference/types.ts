// ============================================================
// Darwin - Inference-Specific Type Definitions
// ============================================================

export interface InferenceRequest {
  prompt: string;
  systemPrompt?: string;
  model?: 'opus' | 'sonnet' | 'haiku';
  maxTokens?: number;
  temperature?: number;
  taskType?: 'code_generation' | 'complex_reasoning' | 'simple_decision' | 'status_check' | 'conversation';
}

export interface InferenceResult {
  content: string;
  model: string;
  durationMs: number;
  error?: string;
}

export interface UsageInfo {
  percentUsed: number;
  rawOutput: string;
  timestamp: number;
}
