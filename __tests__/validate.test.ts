import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/core/config.js'
import { emptyModel } from '../src/core/model.js'
import { applyPatch } from '../src/core/patch.js'
import type { Model, SnapshotDraft } from '../src/core/types.js'
import { validateDraft } from '../src/core/validate.js'

const cfg = structuredClone(DEFAULT_CONFIG)

function baseModel(): Model {
  return applyPatch(
    emptyModel(),
    [{ op: 'add_module', module: { id: 'auth', name: '认证', summary: '管登录', anchors: ['src/auth/**'] } }],
    1,
  ).model
}

function draft(over: Partial<SnapshotDraft>): SnapshotDraft {
  return { kind: 'feature', title: '一个标题', story: '一段说明', patch: [], ...over }
}

describe('validateDraft', () => {
  it('字数预算:title/story/summary 超标即违规', () => {
    const m = baseModel()
    const v1 = validateDraft(draft({ title: '这是一个超级无敌特别长长长长长长长长的标题' }), m, cfg, null, 2)
    expect(v1.some((x) => x.path === 'title' && x.message.includes('超出预算'))).toBe(true)

    const longStory = '字'.repeat(201)
    const v2 = validateDraft(draft({ story: longStory }), m, cfg, null, 2)
    expect(v2.some((x) => x.path === 'story')).toBe(true)

    // story 计数不含空白:200 字 + 大量换行应通过
    const okStory = ('字'.repeat(50) + '\n  ').repeat(4)
    const v3 = validateDraft(draft({ story: okStory, kind: 'fix-confirm' }), m, cfg, null, 2)
    expect(v3.filter((x) => x.path === 'story')).toHaveLength(0)

    const v4 = validateDraft(
      draft({
        patch: [
          {
            op: 'add_module',
            module: { id: 'pay', name: '支付', summary: '这一段模块描述实在是太长了'.repeat(4) },
          },
        ],
      }),
      m,
      cfg,
      null,
      2,
    )
    expect(v4.some((x) => x.path.includes('modules[pay].summary'))).toBe(true)
  })

  it('黑话黑名单命中即打回', () => {
    const c = structuredClone(cfg)
    c.banned_words = ['赋能']
    const v = validateDraft(draft({ story: '本次改动为登录流程赋能' }), baseModel(), c, null, 2)
    expect(v.some((x) => x.message.includes('赋能'))).toBe(true)
  })

  it('结构预算:顶层超 9 个违规', () => {
    let m = emptyModel()
    for (let i = 0; i < 9; i++) {
      m = applyPatch(m, [{ op: 'add_module', module: { id: `m-${i}`, name: `模${i}`, summary: 'x' } }], 1).model
    }
    const v = validateDraft(
      draft({ patch: [{ op: 'add_module', module: { id: 'm-9', name: '模9', summary: 'x' } }] }),
      m,
      cfg,
      null,
      2,
    )
    expect(v.some((x) => x.path === 'modules' && x.message.includes('顶层'))).toBe(true)
  })

  it('结构预算:层深超 3 违规', () => {
    const m = applyPatch(
      emptyModel(),
      [
        { op: 'add_module', module: { id: 'a', name: 'a', summary: 'x' } },
        { op: 'add_module', parent: 'a', module: { id: 'b', name: 'b', summary: 'x' } },
        { op: 'add_module', parent: 'b', module: { id: 'c', name: 'c', summary: 'x' } },
      ],
      1,
    ).model
    const v = validateDraft(
      draft({ patch: [{ op: 'add_module', parent: 'c', module: { id: 'd', name: 'd', summary: 'x' } }] }),
      m,
      cfg,
      null,
      2,
    )
    expect(v.some((x) => x.message.includes('层深'))).toBe(true)
  })

  it('新 id 必须 kebab-case', () => {
    const v = validateDraft(
      draft({ patch: [{ op: 'add_module', module: { id: 'BadId', name: 'x', summary: 'x' } }] }),
      baseModel(),
      cfg,
      null,
      2,
    )
    expect(v.some((x) => x.message.includes('kebab-case'))).toBe(true)
  })

  it('锚点必须命中文件(提供 fileList 时)', () => {
    const files = ['src/auth/login.ts', 'src/pay/index.ts']
    const ok = validateDraft(
      draft({ patch: [{ op: 'add_module', module: { id: 'pay', name: '支付', summary: 'x', anchors: ['src/pay/**'] } }] }),
      baseModel(),
      cfg,
      files,
      2,
    )
    expect(ok).toHaveLength(0)
    const bad = validateDraft(
      draft({ patch: [{ op: 'add_module', module: { id: 'pay', name: '支付', summary: 'x', anchors: ['src/nope/**'] } }] }),
      baseModel(),
      cfg,
      files,
      2,
    )
    expect(bad.some((x) => x.message.includes('锚点没有命中'))).toBe(true)
  })

  it('kind=feature 不允许空补丁;fix-confirm 允许', () => {
    const m = baseModel()
    expect(validateDraft(draft({ kind: 'feature', patch: [] }), m, cfg, null, 2).some((x) => x.path === 'patch')).toBe(true)
    expect(validateDraft(draft({ kind: 'fix-confirm', patch: [] }), m, cfg, null, 2)).toHaveLength(0)
  })

  it('no_change 必须是 dirty_checked 的子集,且引用真实节点', () => {
    const m = baseModel()
    const v = validateDraft(
      draft({ kind: 'fix-confirm', dirty_checked: ['auth'], no_change: ['ghost'] }),
      m,
      cfg,
      null,
      2,
    )
    expect(v.some((x) => x.message.includes('不存在的节点'))).toBe(true)
    const v2 = validateDraft(
      draft({ kind: 'fix-confirm', dirty_checked: [], no_change: ['auth'] }),
      m,
      cfg,
      null,
      2,
    )
    expect(v2.some((x) => x.path === 'no_change')).toBe(true)
  })

  it('未知字段打回:YAML 写岔产生的串行键(实战案例)', () => {
    // 实战中 AI 把 summary 写岔行,产生了 "读策略热加载: null" 这个串行键
    const v = validateDraft(
      draft({
        patch: [
          {
            op: 'add_module',
            module: {
              id: 'proxy',
              name: '代理',
              summary: 'x',
              relations: [{ to: 'auth', kind: 'stores', summary: '写审计事件', 读策略热加载: null } as never],
            },
          },
        ],
      }),
      baseModel(),
      cfg,
      null,
      2,
    )
    expect(v.some((x) => x.message.includes('未知字段: 读策略热加载'))).toBe(true)
  })

  it('未知字段打回:草稿顶层与 op 层', () => {
    const m = baseModel()
    const v1 = validateDraft({ ...draft({}), snapshot: 5 } as never, m, cfg, null, 2)
    expect(v1.some((x) => x.path === 'draft' && x.message.includes('snapshot'))).toBe(true)
    const v2 = validateDraft(
      draft({ patch: [{ op: 'deprecate_module', id: 'auth', reason: '不要了' } as never] }),
      m,
      cfg,
      null,
      2,
    )
    expect(v2.some((x) => x.path === 'patch[0]' && x.message.includes('reason'))).toBe(true)
  })

  it('关系 kind 枚举校验', () => {
    const v = validateDraft(
      draft({
        patch: [{ op: 'add_relation', from: 'auth', relation: { to: 'auth', kind: 'uses' as never, summary: 'x' } }],
      }),
      baseModel(),
      cfg,
      null,
      2,
    )
    expect(v.some((x) => x.message.includes('非法关系类型'))).toBe(true)
  })

  it('补丁不可应用时给出 PatchError 信息', () => {
    const v = validateDraft(
      draft({ patch: [{ op: 'update_module', id: 'ghost', set: { name: 'x' } }] }),
      baseModel(),
      cfg,
      null,
      2,
    )
    expect(v.some((x) => x.path === 'patch' && x.message.includes('不存在'))).toBe(true)
  })
})
