import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import type { ArchmapConfig } from './types.js'

export const DEFAULT_CONFIG: ArchmapConfig = {
  language: 'zh',
  reader: '三个月后忘光了细节的项目作者',
  budgets: {
    name: 12,
    module_summary: 40,
    feature_summary: 40,
    relation_summary: 30,
    title: 20,
    story: 200,
    top_level_modules: 9,
    children_per_level: 9,
    max_depth: 3,
  },
  banned_words: [],
  unowned_ignore: ['.archmap/**', '.claude/**', '.codex/**', '.git/**', '.gitignore', '.mcp.json'],
  gate: { require_on: ['feat'] },
}

export function loadConfig(archmapDir: string): ArchmapConfig {
  const file = path.join(archmapDir, 'config.yaml')
  if (!fs.existsSync(file)) return DEFAULT_CONFIG
  const raw = parse(fs.readFileSync(file, 'utf8')) ?? {}
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    budgets: { ...DEFAULT_CONFIG.budgets, ...(raw.budgets ?? {}) },
    gate: { ...DEFAULT_CONFIG.gate, ...(raw.gate ?? {}) },
  }
}
