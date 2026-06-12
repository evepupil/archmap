import type { PatchOp, Snapshot } from '../core/types.js'

export interface SnapshotChanges {
  added: string[]
  modified: string[]
  deprecated: string[]
}

/** 从补丁操作归类单个快照的变化:新增 > 废弃 > 修改,互斥 */
export function classifyChanges(patch: PatchOp[]): SnapshotChanges {
  const added = new Set<string>()
  const deprecated = new Set<string>()
  const modified = new Set<string>()
  for (const op of patch) {
    switch (op.op) {
      case 'add_module':
        added.add(op.module.id)
        break
      case 'add_feature':
        added.add(op.feature.id)
        break
      case 'deprecate_module':
      case 'deprecate_feature':
        deprecated.add(op.id)
        break
      case 'update_module':
      case 'update_feature':
      case 'move_module':
        modified.add(op.id)
        break
      case 'update_anchors':
        modified.add(op.target)
        break
      case 'add_relation':
      case 'remove_relation':
        modified.add(op.from)
        break
    }
  }
  for (const id of added) {
    modified.delete(id)
    deprecated.delete(id)
  }
  for (const id of deprecated) modified.delete(id)
  return { added: [...added].sort(), modified: [...modified].sort(), deprecated: [...deprecated].sort() }
}

export interface RangeDiff {
  /** 区间内新增且仍存活 */
  added: string[]
  /** 区间内被修改(且非新增/废弃) */
  modified: string[]
  /** 区间前就存在、区间内被废弃 */
  deprecated: string[]
  /** 区间内新增又在区间内废弃(昙花) */
  ephemeral: string[]
  perSnapshot: { snapshot: number; date: string; kind: string; title: string }[]
}

/** 聚合 (from, to] 区间的净架构变化 */
export function diffRange(snapshots: Snapshot[], from: number, to: number): RangeDiff {
  const inRange = [...snapshots]
    .filter((s) => s.snapshot > from && s.snapshot <= to)
    .sort((a, b) => a.snapshot - b.snapshot)

  const state = new Map<string, 'added' | 'modified' | 'deprecated' | 'ephemeral'>()
  for (const snap of inRange) {
    const c = classifyChanges(snap.patch)
    for (const id of c.added) state.set(id, 'added')
    for (const id of c.modified) {
      if (!state.has(id)) state.set(id, 'modified')
      // 已是 added/deprecated 的保持原判
    }
    for (const id of c.deprecated) {
      state.set(id, state.get(id) === 'added' ? 'ephemeral' : 'deprecated')
    }
  }

  const pick = (k: string) =>
    [...state.entries()].filter(([, v]) => v === k).map(([id]) => id).sort()
  return {
    added: pick('added'),
    modified: pick('modified'),
    deprecated: pick('deprecated'),
    ephemeral: pick('ephemeral'),
    perSnapshot: inRange.map((s) => ({ snapshot: s.snapshot, date: s.date, kind: s.kind, title: s.title })),
  }
}
