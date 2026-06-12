import { describe, expect, it } from 'vitest'
import type { Snapshot } from '../src/core/types.js'
import { classifyChanges } from '../src/analysis/diff.js'
import { buildViewData } from '../src/viewer/view.js'

function snap(n: number, patch: Snapshot['patch'], kind: Snapshot['kind'] = 'feature'): Snapshot {
  return { snapshot: n, base: n - 1, date: `2026-06-${10 + n}`, commits: [], kind, title: `s${n}`, story: 'x', patch, dirty_checked: [], no_change: [] }
}

describe('classifyChanges', () => {
  it('按操作归类:新增/修改/废弃', () => {
    const c = classifyChanges([
      { op: 'add_module', module: { id: 'a', name: 'a', summary: 'x' } },
      { op: 'update_module', id: 'b', set: { summary: 'y' } },
      { op: 'deprecate_feature', id: 'c' },
      { op: 'add_relation', from: 'd', relation: { to: 'b', kind: 'calls', summary: 'x' } },
    ])
    expect(c).toEqual({ added: ['a'], modified: ['b', 'd'], deprecated: ['c'] })
  })

  it('互斥优先级:新增 > 废弃 > 修改', () => {
    const c = classifyChanges([
      { op: 'add_module', module: { id: 'a', name: 'a', summary: 'x' } },
      { op: 'update_module', id: 'a', set: { summary: 'y' } },
      { op: 'deprecate_module', id: 'b' },
      { op: 'update_module', id: 'b', set: { name: 'z' } },
    ])
    expect(c.added).toEqual(['a'])
    expect(c.modified).toEqual([])
    expect(c.deprecated).toEqual(['b'])
  })
})

describe('buildViewData', () => {
  it('每个快照一个中间模型,since 记录引入快照号', () => {
    const snaps = [
      snap(1, [{ op: 'add_module', module: { id: 'core', name: '核心', summary: 'x' } }], 'init'),
      snap(2, [{ op: 'add_feature', feature: { id: 'feat-a', name: 'A', summary: 'x', modules: ['core'] } }]),
      snap(3, []),
    ]
    const d = buildViewData('D:/proj/demo', snaps)
    expect(d.project).toBe('demo')
    expect(d.models).toHaveLength(3)
    expect(d.models[0].features).toHaveLength(0)
    expect(d.models[1].features).toHaveLength(1)
    expect(d.models[2].features).toHaveLength(1)
    expect(d.since).toEqual({ core: 1, 'feat-a': 2 })
    expect(d.snapshots[2].changes).toEqual({ added: [], modified: [], deprecated: [] })
  })

  it('快照乱序输入也按编号重放', () => {
    const snaps = [
      snap(2, [{ op: 'add_feature', feature: { id: 'feat-a', name: 'A', summary: 'x', modules: ['core'] } }]),
      snap(1, [{ op: 'add_module', module: { id: 'core', name: '核心', summary: 'x' } }], 'init'),
    ]
    const d = buildViewData('/p', snaps)
    expect(d.snapshots.map((s) => s.snapshot)).toEqual([1, 2])
    expect(d.models[1].features[0].since).toBe(2)
  })
})
