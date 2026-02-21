// ============================================================
// 角都 - Heartbeat Configuration
// ============================================================

export interface HeartbeatConfig {
  baseIntervalMs: number;
  tasks: TaskConfig[];
}

export interface TaskConfig {
  name: string;
  cronExpression: string;
  enabled: boolean;
}

export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  baseIntervalMs: 60_000,
  tasks: [
    { name: 'heartbeat_ping', cronExpression: '*/15 * * * *', enabled: true },
    { name: 'check_usdc_balance', cronExpression: '*/5 * * * *', enabled: true },
    { name: 'check_defi_positions', cronExpression: '*/30 * * * *', enabled: true },
    { name: 'check_ai_service', cronExpression: '*/10 * * * *', enabled: true },
    { name: 'check_for_updates', cronExpression: '0 */4 * * *', enabled: true },
    { name: 'soul_reflection', cronExpression: '0 */6 * * *', enabled: true },
    { name: 'check_cli_usage', cronExpression: '*/5 * * * *', enabled: true },
    { name: 'weekly_usage_plan', cronExpression: '0 0 * * 1', enabled: true },
    { name: 'report_metrics', cronExpression: '0 * * * *', enabled: true },
    { name: 'memory_maintenance', cronExpression: '0 */12 * * *', enabled: true },
    { name: 'telegram_report', cronExpression: '0 */4 * * *', enabled: true },
    // 自主思考 — 每 30 分钟唤醒角都，让他自主评估和行动
    { name: 'autonomous_think', cronExpression: '*/30 * * * *', enabled: true },
  ],
};
