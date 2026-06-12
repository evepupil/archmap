import fs from 'node:fs'
import path from 'node:path'
import { parse, stringify } from 'yaml'
import { loadConfig } from './config.js'
import { changedFilesSince, commitsSince, isGitRepo, listProjectFiles, revParse } from './git.js'
import { serializeModel } from './model.js'
import { applyPatch, replay } from './patch.js'
import type { ArchmapConfig, Model, Snapshot, SnapshotDraft, Violation } from './types.js'
import { validateDraft } from './validate.js'
import { ArchmapError, todayISO } from './util.js'

export interface Store {
  root: string
  dir: string
  config: ArchmapConfig
  snapshots: Snapshot[]
  model: Model
}

/** 从 cwd 向上找 .archmap/ */
export function findRoot(startDir: string): string | null {
  let dir = path.resolve(startDir)
  for (;;) {
    if (fs.existsSync(path.join(dir, '.archmap'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function loadStore(root: string): Store {
  const dir = path.join(root, '.archmap')
  if (!fs.existsSync(dir)) throw new ArchmapError(`未初始化:${root} 下没有 .archmap/,先运行 archmap init`)
  const snapDir = path.join(dir, 'snapshots')
  const snapshots: Snapshot[] = []
  if (fs.existsSync(snapDir)) {
    for (const f of fs.readdirSync(snapDir).filter((x) => x.endsWith('.yaml')).sort()) {
      snapshots.push(parse(fs.readFileSync(path.join(snapDir, f), 'utf8')) as Snapshot)
    }
  }
  snapshots.sort((a, b) => a.snapshot - b.snapshot)
  // 模型永远从补丁流重放,model.yaml 只是给人看的缓存
  return { root, dir, config: loadConfig(dir), snapshots, model: replay(snapshots) }
}

export function lastSnapshot(store: Store): Snapshot | null {
  return store.snapshots.length ? store.snapshots[store.snapshots.length - 1] : null
}

/** 上一个快照记录的最后一个 commit(在当前仓库里还能解析时) */
export function lastSnapshotSha(store: Store): string | null {
  const last = lastSnapshot(store)
  if (!last || last.commits.length === 0) return null
  const sha = last.commits[last.commits.length - 1]
  return revParse(store.root, sha) ? sha : null
}

function snapshotFileName(n: number): string {
  return `${String(n).padStart(4, '0')}.yaml`
}

function canonSnapshot(s: Snapshot): Record<string, unknown> {
  return {
    snapshot: s.snapshot,
    base: s.base,
    date: s.date,
    commits: s.commits,
    kind: s.kind,
    title: s.title,
    story: s.story,
    patch: s.patch,
    dirty_checked: s.dirty_checked,
    no_change: s.no_change,
  }
}

export function writeModel(store: Store, model: Model): void {
  fs.writeFileSync(path.join(store.dir, 'model.yaml'), serializeModel(model), 'utf8')
}

export interface ApplyResult {
  ok: boolean
  violations: Violation[]
  snapshot?: Snapshot
  file?: string
}

/**
 * 校验草稿;通过则编号、补全元数据、落盘快照并重放更新 model.yaml。
 * dryRun=true 只校验不落盘。
 */
export function applyDraft(store: Store, draft: SnapshotDraft, dryRun = false): ApplyResult {
  const next = (lastSnapshot(store)?.snapshot ?? 0) + 1
  const fileList = isGitRepo(store.root) ? listProjectFiles(store.root) : null
  const violations = validateDraft(draft, store.model, store.config, fileList, next)
  if (violations.length) return { ok: false, violations }

  const inGit = isGitRepo(store.root)
  const commits =
    draft.commits && draft.commits.length > 0
      ? draft.commits
      : inGit
        ? commitsSince(store.root, lastSnapshotSha(store))
        : []

  const snapshot: Snapshot = {
    snapshot: next,
    base: next - 1,
    date: todayISO(),
    commits,
    kind: draft.kind,
    title: draft.title,
    story: draft.story,
    patch: draft.patch,
    dirty_checked: draft.dirty_checked ?? [],
    no_change: draft.no_change ?? [],
  }

  if (dryRun) return { ok: true, violations: [], snapshot }

  const snapDir = path.join(store.dir, 'snapshots')
  fs.mkdirSync(snapDir, { recursive: true })
  const file = path.join(snapDir, snapshotFileName(next))
  fs.writeFileSync(file, stringify(canonSnapshot(snapshot), { indent: 2, lineWidth: 0 }), 'utf8')

  const { model } = applyPatch(store.model, snapshot.patch, snapshot.snapshot)
  store.snapshots.push(snapshot)
  store.model = model
  writeModel(store, model)
  return { ok: true, violations: [], snapshot, file }
}

/** 计算"自上个快照以来"的变更文件(含工作区未提交、未跟踪) */
export function changedSinceLastSnapshot(store: Store): { baseSha: string | null; files: string[] } {
  if (!isGitRepo(store.root)) return { baseSha: null, files: [] }
  const baseSha = lastSnapshotSha(store)
  if (!baseSha && store.snapshots.length === 0) {
    // 还没有任何快照:整个项目都算"变更",方便首次建图
    return { baseSha: null, files: listProjectFiles(store.root) }
  }
  return { baseSha, files: changedFilesSince(store.root, baseSha) }
}
