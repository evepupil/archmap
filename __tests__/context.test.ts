import { describe, expect, it } from 'vitest'
import { buildContextReport } from '../src/analysis/context.js'
import { emptyModel } from '../src/core/model.js'
import { applyPatch } from '../src/core/patch.js'
import type { Model, Snapshot } from '../src/core/types.js'

function model(): Model {
  return applyPatch(
    emptyModel(),
    [
      { op: 'add_module', module: { id: 'auth', name: '认证与账号', summary: '登录注册会话', anchors: ['src/auth/**'] } },
      { op: 'add_module', module: { id: 'pay', name: '支付', summary: '收钱退钱对账', anchors: ['src/pay/**'] } },
      { op: 'add_relation', from: 'pay', relation: { to: 'auth', kind: 'depends', summary: '下单前验身份' } },
      { op: 'add_feature', feature: { id: 'feat-wechat-login', name: '微信扫码登录', summary: '扫码即可登录', modules: ['auth'] } },
    ],
    1,
  ).model
}

const snaps: Snapshot[] = [
  {
    snapshot: 1, base: 0, date: '2026-06-10', commits: [], kind: 'init', title: '首次建图', story: 'x',
    patch: [{ op: 'update_module', id: 'auth', set: { summary: '登录注册会话' } }], dirty_checked: [], no_change: [],
  },
]

describe('buildContextReport', () => {
  it('中文模块名命中:返回模块切片含职责/辖区/关系/最近变动', () => {
    const r = buildContextReport(model(), snaps, '给认证与账号加手机号登录', ['src/auth/login.ts', 'src/pay/p.ts'])
    expect(r).toContain('认证与账号')
    expect(r).toContain('src/auth/login.ts')
    expect(r).toContain('最近变动:#0001')
    expect(r).not.toContain('### 支付')
  })

  it('功能名命中时连带其所在模块', () => {
    const r = buildContextReport(model(), snaps, '微信扫码登录加个超时重试', null)
    expect(r).toContain('feat-wechat-login')
    expect(r).toContain('### 认证与账号')
  })

  it('ascii token 命中模块 id 与锚点路径段', () => {
    const r = buildContextReport(model(), snaps, 'fix the pay refund flow in src/pay', null)
    expect(r).toContain('### 支付')
  })

  it('未命中时给全景概览兜底', () => {
    const r = buildContextReport(model(), snaps, '随便改点东西', null)
    expect(r).toContain('全景概览')
    expect(r).toContain('认证与账号')
    expect(r).toContain('支付')
  })
})
