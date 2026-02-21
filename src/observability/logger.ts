// ============================================================
// Darwin - Structured Logger
// ============================================================

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { LogEntry } from '../types.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private minLevel: LogLevel = 'info';
  private logDir: string;
  private logFile: string;

  constructor() {
    this.logDir = join(homedir(), '.darwin', 'logs');
    this.logFile = join(this.logDir, `darwin-${this.dateStr()}.log`);
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  debug(module: string, message: string, data?: Record<string, unknown>): void {
    this.log('debug', module, message, data);
  }

  info(module: string, message: string, data?: Record<string, unknown>): void {
    this.log('info', module, message, data);
  }

  warn(module: string, message: string, data?: Record<string, unknown>): void {
    this.log('warn', module, message, data);
  }

  error(module: string, message: string, data?: Record<string, unknown>): void {
    this.log('error', module, message, data);
  }

  private log(level: LogLevel, module: string, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      module,
      message,
      data,
    };

    const ts = new Date(entry.timestamp).toISOString();
    const prefix = `[${ts}] [${level.toUpperCase().padEnd(5)}] [${module}]`;
    const line = data
      ? `${prefix} ${message} ${JSON.stringify(data)}`
      : `${prefix} ${message}`;

    // Console output
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }

    // File output
    this.writeToFile(line);
  }

  private writeToFile(line: string): void {
    try {
      if (!existsSync(this.logDir)) {
        mkdirSync(this.logDir, { recursive: true });
      }
      appendFileSync(this.logFile, line + '\n');
    } catch {
      // Silently fail file logging
    }
  }

  private dateStr(): string {
    return new Date().toISOString().split('T')[0];
  }
}

export const logger = new Logger();
