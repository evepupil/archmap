import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initProject } from '../src/setup/init.js'
import { McpEngine } from '../src/mcp/engine.js'
import { applyDraft, loadStore } from '../src/store/snapshot.js'

let tmp: string
let engine: McpEngine

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archmap-mcp-'))
  initProject(tmp, { home: tmp }) // home 指到空目录,避免 Codex 探测干扰
  applyDraft(loadStore(tmp), {
    kind: 'init',
    title: '首次建图',
    story: '测试项目。',
    patch: [
      { op: 'add_module', module: { id: 'core', name: '核心', summary: '业务核心' } },
      { op: 'add_feature', feature: { id: 'feat-hello', name: '打招呼', summary: '会说你好', modules: ['core'] } },
    ],
  })
  engine = new McpEngine({ cwd: tmp, version: '0.0.0-test' })
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

const call = (method: string, params?: Record<string, unknown>, id: number | undefined = 1) =>
  engine.handle({ jsonrpc: '2.0', ...(id !== undefined ? { id } : {}), method, params })

describe('McpEngine 协议层', () => {
  it('initialize 返回能力、版本与 instructions', async () => {
    const r = await call('initialize', { protocolVersion: '2025-03-26' })
    const res = r!.result as Record<string, never>
    expect(res['protocolVersion']).toBe('2025-03-26')
    expect(JSON.stringify(res['capabilities'])).toContain('tools')
    expect(String(res['instructions'])).toContain('archmap_context')
  })

  it('通知不回包,未知方法回错误', async () => {
    expect(await call('notifications/initialized', {}, undefined)).toBeNull()
    const r = await call('resources/list')
    expect(r!.error?.code).toBe(-32601)
  })

  it('tools/list 五个工具;白名单可裁剪', async () => {
    const r = await call('tools/list')
    expect((r!.result as { tools: unknown[] }).tools).toHaveLength(5)
    const slim = new McpEngine({ cwd: tmp, version: 't', allow: 'status,archmap_dirty' })
    const r2 = await slim.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect((r2!.result as { tools: { name: string }[] }).tools.map((t) => t.name).sort()).toEqual([
      'archmap_dirty',
      'archmap_status',
    ])
  })
})

describe('McpEngine 工具调用', () => {
  const text = (r: { result?: unknown } | null) =>
    (r!.result as { content: { text: string }[] }).content[0].text
  const isErr = (r: { result?: unknown } | null) => (r!.result as { isError?: boolean }).isError === true

  it('archmap_status 返回健康度', async () => {
    const r = await call('tools/call', { name: 'archmap_status', arguments: {} })
    expect(text(r)).toContain('快照: 1 个')
  })

  it('archmap_context 命中模块', async () => {
    const r = await call('tools/call', { name: 'archmap_context', arguments: { task: '给核心模块加东西' } })
    expect(text(r)).toContain('核心')
  })

  it('archmap_patch dry_run 校验失败返回 isError 与 violation 列表', async () => {
    const r = await call('tools/call', {
      name: 'archmap_patch',
      arguments: { kind: 'feature', title: '超长'.repeat(20), story: 'x', patch: [], dry_run: true },
    })
    expect(isErr(r)).toBe(true)
    expect(text(r)).toContain('超出预算')
  })

  it('archmap_patch 落盘成功,archmap_diff 能看到', async () => {
    const r = await call('tools/call', {
      name: 'archmap_patch',
      arguments: {
        kind: 'feature',
        title: '加支付',
        story: '加了支付模块。',
        patch: [{ op: 'add_module', module: { id: 'pay', name: '支付', summary: '管收钱' } }],
      },
    })
    expect(text(r)).toContain('已写入快照 2')
    const d = await call('tools/call', { name: 'archmap_diff', arguments: { from: 1 } })
    expect(text(d)).toContain('新增 (1): pay')
  })

  it('非法 range 与未知工具被拒', async () => {
    const r = await call('tools/call', { name: 'archmap_dirty', arguments: { range: '--output=/tmp/x' } })
    expect(isErr(r)).toBe(true)
    const r2 = await call('tools/call', { name: 'archmap_nope', arguments: {} })
    expect(r2!.error?.code).toBe(-32602)
  })

  it('projectPath 路由到其他项目;未初始化目录报可读错误', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'archmap-noinit-'))
    const r = await call('tools/call', { name: 'archmap_status', arguments: { projectPath: other } })
    expect(isErr(r)).toBe(true)
    expect(text(r)).toContain('archmap init')
    fs.rmSync(other, { recursive: true, force: true })
  })
})
