import { execFileSync } from 'node:child_process'
import { toPosix } from '../core/util.js'

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

function lines(s: string | null): string[] {
  if (!s) return []
  return s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
    .map(toPosix)
}

export function isGitRepo(root: string): boolean {
  return git(root, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true'
}

export function revParse(root: string, ref: string): string | null {
  return git(root, ['rev-parse', '--short', ref])?.trim() ?? null
}

/** 全部已跟踪 + 未跟踪未忽略的文件,作为"项目里真实存在的文件"清单 */
export function listProjectFiles(root: string): string[] {
  const tracked = lines(git(root, ['ls-files']))
  const untracked = lines(git(root, ['ls-files', '--others', '--exclude-standard']))
  return [...new Set([...tracked, ...untracked])]
}

/** 从 base 提交到工作区(含未提交、未跟踪)的全部变更文件 */
export function changedFilesSince(root: string, baseSha: string | null): string[] {
  const out = new Set<string>()
  if (baseSha) {
    for (const f of lines(git(root, ['diff', '--name-only', baseSha]))) out.add(f)
  } else {
    for (const f of lines(git(root, ['diff', '--name-only', 'HEAD']))) out.add(f)
  }
  for (const f of lines(git(root, ['ls-files', '--others', '--exclude-standard']))) out.add(f)
  return [...out]
}

/** 指定区间的变更文件(--range a..b 时用) */
export function changedFilesInRange(root: string, range: string): string[] {
  return lines(git(root, ['diff', '--name-only', range]))
}

export interface Rename {
  from: string
  to: string
}

function parseRenames(out: string | null): Rename[] {
  if (!out) return []
  const renames: Rename[] = []
  for (const line of out.split('\n')) {
    const parts = line.split('\t')
    if (parts.length === 3 && parts[0].startsWith('R')) {
      renames.push({ from: toPosix(parts[1].trim()), to: toPosix(parts[2].trim()) })
    }
  }
  return renames
}

/** base 到工作区的文件改名对(git -M 探测),目录重构时给锚点迁移当线索 */
export function renamesSince(root: string, baseSha: string | null): Rename[] {
  return parseRenames(git(root, ['diff', '--name-status', '-M', baseSha ?? 'HEAD']))
}

export function renamesInRange(root: string, range: string): Rename[] {
  return parseRenames(git(root, ['diff', '--name-status', '-M', range]))
}

/** base(不含)到 HEAD 的提交短 SHA,旧的在前 */
export function commitsSince(root: string, baseSha: string | null): string[] {
  const range = baseSha ? `${baseSha}..HEAD` : 'HEAD'
  const out = lines(git(root, ['log', '--format=%h', '--reverse', range]))
  if (out.length === 0 && !baseSha) {
    const head = revParse(root, 'HEAD')
    return head ? [head] : []
  }
  return out
}

/** base(不含)到 HEAD 的提交主题行,旧的在前,供 gate 检查 commit 前缀 */
export function commitSubjectsSince(root: string, baseSha: string | null): string[] {
  const range = baseSha ? `${baseSha}..HEAD` : 'HEAD'
  return (git(root, ['log', '--format=%s', '--reverse', range]) ?? '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
}
