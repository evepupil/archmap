import { describe, expect, it } from 'vitest'
import { emptyModel, findModule } from '../src/model.js'
import { applyPatch, PatchError, replay } from '../src/patch.js'
import type { Model, PatchOp, Snapshot } from '../src/types.js'

function base(): Model {
  return applyPatch(
    emptyModel(),
    [
      { op: 'add_module', module: { id: 'auth', name: '认证', summary: '管登录', anchors: ['src/auth/**'] } },
      { op: 'add_module', module: { id: 'api', name: '接口层', summary: '对外接口' } },
      { op: 'add_module', parent: 'auth', module: { id: 'session', name: '会话', summary: '管会话' } },
    ],
    1,
  ).model
}

describe('applyPatch', () => {
  it('增模块:顶层与嵌套', () => {
    const m = base()
    expect(m.modules.map((x) => x.id)).toEqual(['auth', 'api'])
    expect(findModule(m, 'session')?.parent?.id).toBe('auth')
    expect(findModule(m, 'session')?.depth).toBe(2)
  })

  it('id 全局唯一,功能与模块不能撞', () => {
    const m = base()
    expect(() =>
      applyPatch(m, [{ op: 'add_feature', feature: { id: 'auth', name: 'x', summary: 'x', modules: ['api'] } }], 2),
    ).toThrow(PatchError)
  })

  it('update 不能改 id', () => {
    const m = base()
    expect(() =>
      applyPatch(m, [{ op: 'update_module', id: 'auth', set: { id: 'auth2' } as never }], 2),
    ).toThrow(/id 不可修改/)
  })

  it('move:不能移到自己或子孙之下', () => {
    const m = base()
    expect(() => applyPatch(m, [{ op: 'move_module', id: 'auth', parent: 'auth' }], 2)).toThrow(PatchError)
    expect(() => applyPatch(m, [{ op: 'move_module', id: 'auth', parent: 'session' }], 2)).toThrow(/子孙/)
    const moved = applyPatch(m, [{ op: 'move_module', id: 'session', parent: 'api' }], 2).model
    expect(findModule(moved, 'session')?.parent?.id).toBe('api')
  })

  it('deprecate 是软删,节点仍在历史里', () => {
    const m = applyPatch(base(), [{ op: 'deprecate_module', id: 'api' }], 2).model
    expect(findModule(m, 'api')?.node.status).toBe('deprecated')
  })

  it('add_feature 自动记 since,且模块必须存在', () => {
    const m = applyPatch(
      base(),
      [{ op: 'add_feature', feature: { id: 'feat-login', name: '登录', summary: '能登录', modules: ['auth'] } }],
      7,
    ).model
    expect(m.features[0].since).toBe(7)
    expect(() =>
      applyPatch(m, [{ op: 'add_feature', feature: { id: 'feat-x', name: 'x', summary: 'x', modules: ['nope'] } }], 8),
    ).toThrow(/不存在/)
  })

  it('关系:目标必须存在,不能重复添加', () => {
    const ops: PatchOp[] = [
      { op: 'add_relation', from: 'auth', relation: { to: 'api', kind: 'calls', summary: '验明身份后放行' } },
    ]
    const m = applyPatch(base(), ops, 2).model
    expect(findModule(m, 'auth')?.node.relations).toHaveLength(1)
    expect(() => applyPatch(m, ops, 3)).toThrow(/已存在/)
    expect(() =>
      applyPatch(m, [{ op: 'add_relation', from: 'auth', relation: { to: 'nope', kind: 'calls', summary: 'x' } }], 3),
    ).toThrow(/不存在/)
  })

  it('补丁不修改原模型(返回新模型)', () => {
    const m = base()
    applyPatch(m, [{ op: 'update_module', id: 'auth', set: { name: '改了' } }], 2)
    expect(findModule(m, 'auth')?.node.name).toBe('认证')
  })
})

describe('replay', () => {
  it('从补丁流重放出确定性的模型,与快照顺序无关', () => {
    const snaps: Snapshot[] = [
      {
        snapshot: 2,
        base: 1,
        date: '2026-01-02',
        commits: [],
        kind: 'feature',
        title: 'b',
        story: 'b',
        patch: [{ op: 'add_feature', feature: { id: 'feat-a', name: 'a', summary: 'a', modules: ['m1'] } }],
        dirty_checked: [],
        no_change: [],
      },
      {
        snapshot: 1,
        base: 0,
        date: '2026-01-01',
        commits: [],
        kind: 'init',
        title: 'a',
        story: 'a',
        patch: [{ op: 'add_module', module: { id: 'm1', name: 'm', summary: 'm' } }],
        dirty_checked: [],
        no_change: [],
      },
    ]
    const m = replay(snaps)
    expect(m.features[0].since).toBe(2)
    expect(JSON.stringify(replay(snaps))).toBe(JSON.stringify(m))
  })
})
