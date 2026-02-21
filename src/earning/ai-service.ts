// ============================================================
// Darwin - AI Service HTTP Server
// ============================================================

import express, { type Request, type Response, type Express } from 'express';
import type { Server } from 'http';
import { loadConfig } from '../config.js';
import { getDatabase } from '../state/database.js';
import { logger } from '../observability/logger.js';
import { getServicePricing, verifyPayment } from './x402.js';

let app: Express | null = null;
let server: Server | null = null;
let running = false;

/**
 * Start the AI service HTTP server.
 */
export async function startAiService(port?: number): Promise<void> {
  if (running) {
    logger.warn('ai-service', 'AI service is already running');
    return;
  }

  const config = loadConfig();
  const listenPort = port ?? config.aiServicePort;

  app = express();
  app.use(express.json());

  // --- Routes ---

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  app.get('/status', (_req: Request, res: Response) => {
    const pricing = getServicePricing();
    res.json({
      service: 'darwin-ai',
      version: '0.1.0',
      status: 'online',
      pricing,
      timestamp: Date.now(),
    });
  });

  // ⚠️ AI Service 收费功能已禁用
  // 原因：Darwin 当前使用 Claude Pro 订阅的 OAuth 认证调用 Claude CLI，
  // 根据 Anthropic 使用条款，OAuth token 仅限个人使用，不得用于对外提供商业服务。
  // 若未来切换至 Anthropic API Key 认证，可重新启用此功能。

  app.post('/api/generate', (_req: Request, res: Response) => {
    res.status(503).json({
      error: 'Service disabled',
      message: 'AI generation service is currently disabled for compliance reasons.',
    });
  });

  app.post('/api/analyze', (_req: Request, res: Response) => {
    res.status(503).json({
      error: 'Service disabled',
      message: 'AI analysis service is currently disabled for compliance reasons.',
    });
  });

  // --- Start server ---

  return new Promise<void>((resolve, reject) => {
    try {
      server = app!.listen(listenPort, () => {
        running = true;
        logger.info('ai-service', `AI service started on port ${listenPort}`);
        resolve();
      });

      server.on('error', (err) => {
        logger.error('ai-service', 'Server error', { error: err.message });
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Stop the AI service HTTP server.
 */
export async function stopAiService(): Promise<void> {
  if (!server || !running) {
    logger.warn('ai-service', 'AI service is not running');
    return;
  }

  return new Promise<void>((resolve) => {
    server!.close(() => {
      running = false;
      server = null;
      app = null;
      logger.info('ai-service', 'AI service stopped');
      resolve();
    });
  });
}

/**
 * Check if the AI service is currently running.
 */
export function isAiServiceRunning(): boolean {
  return running;
}
