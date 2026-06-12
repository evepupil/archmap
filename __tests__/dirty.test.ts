import { describe, expect, it } from 'vitest'
import { computeDirty } from '../src/analysis/dirty.js'
import { emptyModel } from '../src/core/model.js'
import { applyPatch } from '../src/core/patch.js'
import type { Model } from '../src/core/types.js'

function model(): Model {
  return applyPatch(
    emptyModel(),
    [
      { op: 'add_module', module: { id: 'auth', name: '认证', summary: 'x', anchors: ['src/auth/**'] } },
      { op: 'add_module', parent: 'auth', module: { id: 'session', name: '会话', summary: 'x', anchors: ['src/middleware/session.ts'] } },
      { op: 'add_module', module: { id: 'pay', name: '支付', summary: 'x', anchors: ['src/pay/**'] } },
      { op: 'add_feature', feature: { id: 'feat-login', name: '登录', summary: 'x', modules: ['auth'] } },
      { op: 'add_feature', feature: { id: 'feat-refund', name: '退款', summary: 'x', modules: ['pay'], anchors: ['src/pay/refund.ts#refund'] } },
    ],
    1,
  ).model
}

describe('computeDirty', () => {
  it('锚点命中 → 脏模块,并向上传播到祖先', () => {
    const r = computeDirty(model(), ['src/middleware/session.ts'])
    expect(r.dirtyModules).toEqual(['auth', 'session'])
    expect(r.dirtyFeatures).toEqual(['feat-login'])
    expect(r.unowned).toEqual([])
  })

  it('功能跟随所挂模块变脏;符号级锚点按文件部分匹配', () => {
    const r = computeDirty(model(), ['src/pay/refund.ts'])
    expect(r.dirtyModules).toEqual(['pay'])
    expect(r.dirtyFeatures).toEqual(['feat-refund'])
  })

  it('没人认领的文件进无主清单', () => {
    const r = computeDirty(model(), ['src/notify/mail.ts', 'src/auth/login.ts'])
    expect(r.dirtyModules).toEqual(['auth'])
    expect(r.unowned).toEqual(['src/notify/mail.ts'])
  })

  it('忽略清单里的文件不参与判定', () => {
    const r = computeDirty(model(), ['.archmap/model.yaml', 'README.md'], ['.archmap/**'])
    expect(r.changed).toEqual(['README.md'])
    expect(r.unowned).toEqual(['README.md'])
  })

  it('windows 反斜杠路径正常匹配', () => {
    const r = computeDirty(model(), ['src\\auth\\login.ts'])
    expect(r.dirtyModules).toEqual(['auth'])
  })

  it('废弃模块(含子树)不认领文件', () => {
    const m = applyPatch(model(), [{ op: 'deprecate_module', id: 'auth' }], 2).model
    const r = computeDirty(m, ['src/auth/login.ts', 'src/middleware/session.ts'])
    expect(r.dirtyModules).toEqual([])
    expect(r.unowned.sort()).toEqual(['src/auth/login.ts', 'src/middleware/session.ts'])
  })
})
