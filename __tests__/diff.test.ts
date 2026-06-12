import { describe, expect, it } from 'vitest'
import { diffRange } from '../src/analysis/diff.js'
import type { Snapshot } from '../src/core/types.js'

function snap(n: number, patch: Snapshot['patch']): Snapshot {
  return { snapshot: n, base: n - 1, date: '2026-06-01', commits: [], kind: 'feature', title: `s${n}`, story: 'x', patch, dirty_checked: [], no_change: [] }
}

const snaps: Snapshot[] = [
  snap(1, [{ op: 'add_module', module: { id: 'a', name: 'a', summary: 'x' } }]),
  snap(2, [
    { op: 'add_module', module: { id: 'b', name: 'b', summary: 'x' } },
    { op: 'update_module', id: 'a', set: { summary: 'y' } },
  ]),
  snap(3, [{ op: 'deprecate_module', id: 'b' }]),
  snap(4, [{ op: 'deprecate_module', id: 'a' }]),
]

describe('diffRange', () => {
  it('聚合区间净变化:新增后修改仍算新增', () => {
    const d = diffRange(snaps, 0, 2)
    expect(d.added.sort()).toEqual(['a', 'b'])
    expect(d.modified).toEqual([])
  })

  it('区间内出现又废弃 = 昙花;区间前已存在被废弃 = 废弃', () => {
    const d = diffRange(snaps, 1, 4)
    expect(d.ephemeral).toEqual(['b'])
    expect(d.deprecated).toEqual(['a'])
    expect(d.added).toEqual([])
  })

  it('修改与区间快照列表', () => {
    const d = diffRange(snaps, 1, 2)
    expect(d.modified).toEqual(['a'])
    expect(d.perSnapshot.map((s) => s.snapshot)).toEqual([2])
  })
})
