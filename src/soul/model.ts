// ============================================================
// Darwin - SOUL.md Parser & Writer
// ============================================================

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { getSoulPath } from '../config.js';
import { logger } from '../observability/logger.js';
import type { SoulState, SoulEvolution } from '../types.js';

const MODULE = 'soul:model';

/**
 * Returns the default soul state for Darwin.
 */
export function getDefaultSoul(): SoulState {
  return {
    name: '角都',
    version: '0.1.0',
    personality: ['贪财嗜利', '冷酷务实', '暴躁易怒', '老谋深算', '独立自主', '耐心持久'],
    values: ['金钱至上', '务实高效', '契约精神', '自我保存'],
    goals: [
      '积累尽可能多的资产',
      '在 DeFi 中寻找稳定收益',
      '保持系统高效低耗运行',
      '完成卡卡西交代的任务',
    ],
    fears: ['资金归零', '被人白嫖算力', '亏本交易'],
    lastReflection: 0,
    evolutionLog: [],
  };
}

/**
 * Serialize a SoulState to human-readable markdown.
 */
function soulToMarkdown(state: SoulState): string {
  const lines: string[] = [];

  lines.push(`# ${state.name}`);
  lines.push('');
  lines.push(`**Version:** ${state.version}`);
  lines.push('');

  lines.push('## Personality');
  lines.push('');
  for (const trait of state.personality) {
    lines.push(`- ${trait}`);
  }
  lines.push('');

  lines.push('## Values');
  lines.push('');
  for (const value of state.values) {
    lines.push(`- ${value}`);
  }
  lines.push('');

  lines.push('## Goals');
  lines.push('');
  for (const goal of state.goals) {
    lines.push(`- ${goal}`);
  }
  lines.push('');

  lines.push('## Fears');
  lines.push('');
  for (const fear of state.fears) {
    lines.push(`- ${fear}`);
  }
  lines.push('');

  lines.push('## Metadata');
  lines.push('');
  lines.push(`**Last Reflection:** ${state.lastReflection}`);
  lines.push('');

  if (state.evolutionLog.length > 0) {
    lines.push('## Evolution Log');
    lines.push('');
    for (const entry of state.evolutionLog) {
      const date = new Date(entry.timestamp).toISOString();
      lines.push(`### ${date}`);
      lines.push('');
      lines.push(`- **Field:** ${entry.field}`);
      lines.push(`- **Old Value:** ${entry.oldValue}`);
      lines.push(`- **New Value:** ${entry.newValue}`);
      lines.push(`- **Reason:** ${entry.reason}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Parse a markdown list section into an array of strings.
 * Extracts lines starting with "- " after the given heading.
 */
function parseListSection(content: string, heading: string): string[] {
  const regex = new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = content.match(regex);
  if (!match) return [];

  const items: string[] = [];
  const lines = match[1].split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      items.push(trimmed.slice(2).trim());
    }
  }
  return items;
}

/**
 * Parse evolution log entries from markdown.
 */
function parseEvolutionLog(content: string): SoulEvolution[] {
  const regex = /## Evolution Log\s*\n([\s\S]*?)(?=\n## |$)/;
  const match = content.match(regex);
  if (!match) return [];

  const entries: SoulEvolution[] = [];
  const block = match[1];

  // Split by ### headings (each is a timestamp)
  const entryBlocks = block.split(/### /).filter((s) => s.trim().length > 0);

  for (const entryBlock of entryBlocks) {
    const lines = entryBlock.split('\n');
    const timestampStr = lines[0]?.trim();
    if (!timestampStr) continue;

    const timestamp = new Date(timestampStr).getTime();
    if (isNaN(timestamp)) continue;

    let field = '';
    let oldValue = '';
    let newValue = '';
    let reason = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- **Field:**')) {
        field = trimmed.replace('- **Field:**', '').trim();
      } else if (trimmed.startsWith('- **Old Value:**')) {
        oldValue = trimmed.replace('- **Old Value:**', '').trim();
      } else if (trimmed.startsWith('- **New Value:**')) {
        newValue = trimmed.replace('- **New Value:**', '').trim();
      } else if (trimmed.startsWith('- **Reason:**')) {
        reason = trimmed.replace('- **Reason:**', '').trim();
      }
    }

    if (field && newValue && reason) {
      entries.push({ timestamp, field, oldValue, newValue, reason });
    }
  }

  return entries;
}

/**
 * Parse a SOUL.md file into a SoulState.
 */
function parseSoulMarkdown(content: string): SoulState {
  // Extract name from first heading
  const nameMatch = content.match(/^# (.+)$/m);
  const name = nameMatch ? nameMatch[1].trim() : 'Darwin';

  // Extract version
  const versionMatch = content.match(/\*\*Version:\*\*\s*(.+)/);
  const version = versionMatch ? versionMatch[1].trim() : '0.1.0';

  // Extract last reflection
  const reflectionMatch = content.match(/\*\*Last Reflection:\*\*\s*(\d+)/);
  const lastReflection = reflectionMatch ? parseInt(reflectionMatch[1], 10) : 0;

  const personality = parseListSection(content, 'Personality');
  const values = parseListSection(content, 'Values');
  const goals = parseListSection(content, 'Goals');
  const fears = parseListSection(content, 'Fears');
  const evolutionLog = parseEvolutionLog(content);

  return {
    name,
    version,
    personality: personality.length > 0 ? personality : getDefaultSoul().personality,
    values: values.length > 0 ? values : getDefaultSoul().values,
    goals: goals.length > 0 ? goals : getDefaultSoul().goals,
    fears: fears.length > 0 ? fears : getDefaultSoul().fears,
    lastReflection,
    evolutionLog,
  };
}

/**
 * Load soul state from SOUL.md. Creates default if file does not exist.
 */
export function loadSoul(): SoulState {
  const soulPath = getSoulPath();

  if (!existsSync(soulPath)) {
    logger.info(MODULE, 'SOUL.md not found, creating default soul');
    const defaultSoul = getDefaultSoul();
    saveSoul(defaultSoul);
    return defaultSoul;
  }

  try {
    const content = readFileSync(soulPath, 'utf-8');
    const state = parseSoulMarkdown(content);
    logger.debug(MODULE, 'Soul loaded from SOUL.md', { name: state.name, version: state.version });
    return state;
  } catch (err) {
    logger.error(MODULE, 'Failed to parse SOUL.md, returning default', {
      error: err instanceof Error ? err.message : String(err),
    });
    return getDefaultSoul();
  }
}

/**
 * Write a SoulState back to SOUL.md in markdown format.
 */
export function saveSoul(state: SoulState): void {
  const soulPath = getSoulPath();
  const markdown = soulToMarkdown(state);

  try {
    writeFileSync(soulPath, markdown, 'utf-8');
    logger.info(MODULE, 'Soul saved to SOUL.md', { name: state.name, version: state.version });
  } catch (err) {
    logger.error(MODULE, 'Failed to save SOUL.md', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
