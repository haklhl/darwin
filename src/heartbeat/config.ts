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
    { name: 'heartbeat_ping', cronExpression: '*/30 * * * *', enabled: true },
    { name: 'check_usdc_balance', cronExpression: '*/15 * * * *', enabled: true },
    { name: 'check_defi_positions', cronExpression: '0 * * * *', enabled: true },
    { name: 'check_ai_service', cronExpression: '*/30 * * * *', enabled: true },
    { name: 'check_for_updates', cronExpression: '0 */6 * * *', enabled: true },
    { name: 'soul_reflection', cronExpression: '0 */8 * * *', enabled: true },
    { name: 'check_cli_usage', cronExpression: '*/15 * * * *', enabled: true },
    { name: 'weekly_usage_plan', cronExpression: '0 0 * * 1', enabled: true },
    { name: 'report_metrics', cronExpression: '0 */2 * * *', enabled: true },
    { name: 'memory_maintenance', cronExpression: '0 */12 * * *', enabled: true },
    { name: 'telegram_report', cronExpression: '0 */6 * * *', enabled: true },
    // 自主思考 — 每 60 分钟唤醒角都（降频，避免过于频繁）
    { name: 'autonomous_think', cronExpression: '0 * * * *', enabled: true },
    // X/Twitter 发帖 — 每 4 小时触发一次
    { name: 'tweet_time', cronExpression: '0 */4 * * *', enabled: true },
  ],
};
