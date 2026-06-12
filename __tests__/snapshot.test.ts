import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { initProject } from '../src/init.js'
import { applyDraft, findRoot, loadStore } from '../src/snapshot.js'
import type { Snapshot, SnapshotDraft } from '../src/types.js'

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archmap-test-'))
  initProject(tmp)
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function initDraft(): SnapshotDraft {
  return {
    kind: 'init',
    title: '首次建图',
    story: '这是一个测试项目。',
    patch: [
      { op: 'add_module', module: { id: 'core', name: '核心', summary: '业务核心逻辑' } },
      { op: 'add_feature', feature: { id: 'feat-hello', name: '打招呼', summary: '会说你好', modules: ['core'] } },
    ],
  }
}

describe('applyDraft 落盘流程(非 git 环境)', () => {
  it('快照编号、base、since 自动补全,model.yaml 同步重建', () => {
    const store = loadStore(tmp)
    const r = applyDraft(store, initDraft())
    expect(r.ok).toBe(true)
    expect(r.snapshot!.snapshot).toBe(1)
    expect(r.snapshot!.base).toBe(0)

    const snapFile = path.join(tmp, '.archmap', 'snapshots', '0001.yaml')
    expect(fs.existsSync(snapFile)).toBe(true)
    const onDisk = parse(fs.readFileSync(snapFile, 'utf8')) as Snapshot
    expect(onDisk.kind).toBe('init')

    const model = parse(fs.readFileSync(path.join(tmp, '.archmap', 'model.yaml'), 'utf8'))
    expect(model.modules[0].id).toBe('core')
    expect(model.features[0].since).toBe(1)
  })

  it('连续两个快照,重新 loadStore 后模型来自补丁流重放', () => {
    const store = loadStore(tmp)
    applyDraft(store, initDraft())
    const r2 = applyDraft(store, {
      kind: 'feature',
      title: '加支付',
      story: '加了支付模块。',
      patch: [{ op: 'add_module', module: { id: 'pay', name: '支付', summary: '管收钱' } }],
    })
    expect(r2.snapshot!.snapshot).toBe(2)

    const reloaded = loadStore(tmp)
    expect(reloaded.snapshots).toHaveLength(2)
    expect(reloaded.model.modules.map((m) => m.id)).toEqual(['core', 'pay'])
  })

  it('校验失败不落盘任何文件', () => {
    const store = loadStore(tmp)
    const r = applyDraft(store, { ...initDraft(), title: '超长'.repeat(20) })
    expect(r.ok).toBe(false)
    expect(fs.readdirSync(path.join(tmp, '.archmap', 'snapshots')).filter((f) => f.endsWith('.yaml'))).toHaveLength(0)
  })

  it('dryRun 只校验不写盘', () => {
    const store = loadStore(tmp)
    const r = applyDraft(store, initDraft(), true)
    expect(r.ok).toBe(true)
    expect(fs.readdirSync(path.join(tmp, '.archmap', 'snapshots')).filter((f) => f.endsWith('.yaml'))).toHaveLength(0)
  })
})

describe('findRoot / initProject', () => {
  it('从子目录向上找到 .archmap', () => {
    const sub = path.join(tmp, 'src', 'deep')
    fs.mkdirSync(sub, { recursive: true })
    expect(findRoot(sub)).toBe(tmp)
  })

  it('init 幂等:已存在的文件不覆盖', () => {
    fs.writeFileSync(path.join(tmp, '.archmap', 'config.yaml'), 'language: en\n', 'utf8')
    const r = initProject(tmp)
    expect(r.skipped).toContain(path.join('.archmap', 'config.yaml'))
    expect(fs.readFileSync(path.join(tmp, '.archmap', 'config.yaml'), 'utf8')).toContain('en')
  })

  it('init 安装两个 skill 到 .claude/skills/', () => {
    expect(fs.existsSync(path.join(tmp, '.claude', 'skills', 'archmap-snapshot', 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(tmp, '.claude', 'skills', 'archmap-audit', 'SKILL.md'))).toBe(true)
  })

  it('检测到 Codex 时同步投放到 .codex/skills/,否则不投放', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'archmap-home-'))
    fs.mkdirSync(path.join(fakeHome, '.codex'))
    const p1 = fs.mkdtempSync(path.join(os.tmpdir(), 'archmap-cx-'))
    const r1 = initProject(p1, { home: fakeHome })
    expect(r1.codex).toBe(true)
    expect(fs.existsSync(path.join(p1, '.codex', 'skills', 'archmap-snapshot', 'SKILL.md'))).toBe(true)

    const p2 = fs.mkdtempSync(path.join(os.tmpdir(), 'archmap-nocx-'))
    const r2 = initProject(p2, { home: fs.mkdtempSync(path.join(os.tmpdir(), 'archmap-home2-')) })
    expect(r2.codex).toBe(false)
    expect(fs.existsSync(path.join(p2, '.codex'))).toBe(false)
    for (const d of [fakeHome, p1, p2]) fs.rmSync(d, { recursive: true, force: true })
  })
})
