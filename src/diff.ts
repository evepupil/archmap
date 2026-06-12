import type { Snapshot } from './types.js'
import { classifyChanges } from './view.js'

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
