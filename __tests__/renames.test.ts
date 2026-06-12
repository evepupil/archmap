import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileOwners } from '../src/analysis/dirty.js'
import { dirtyReport } from '../src/analysis/reports.js'
import { DEFAULT_CONFIG } from '../src/core/config.js'
import { emptyModel } from '../src/core/model.js'
import { applyPatch } from '../src/core/patch.js'
import { renamesSince } from '../src/store/git.js'
import type { Store } from '../src/store/snapshot.js'

let tmp: string
const git = (args: string[]) => execFileSync('git', args, { cwd: tmp, encoding: 'utf8' })

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archmap-rn-'))
  git(['init', '-q'])
  git(['config', 'user.email', 't@t.t'])
  git(['config', 'user.name', 't'])
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('renamesSince(真实 git)', () => {
  it('git mv 后能拿到旧→新映射', () => {
    fs.mkdirSync(path.join(tmp, 'src', 'auth'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'src', 'auth', 'login.ts'), 'const x = 1\nconst y = 2\n')
    git(['add', '-A'])
    git(['commit', '-qm', 'init'])
    const base = git(['rev-parse', '--short', 'HEAD']).trim()
    fs.mkdirSync(path.join(tmp, 'src', 'core'), { recursive: true })
    git(['mv', 'src/auth', 'src/core/auth'])
    const renames = renamesSince(tmp, base)
    expect(renames).toEqual([{ from: 'src/auth/login.ts', to: 'src/core/auth/login.ts' }])
  })
})

describe('迁移线索报告', () => {
  const model = applyPatch(
    emptyModel(),
    [{ op: 'add_module', module: { id: 'auth', name: '认证', summary: 'x', anchors: ['src/auth/**'] } }],
    1,
  ).model

  it('fileOwners 按锚点定位旧路径归属', () => {
    expect(fileOwners(model, 'src/auth/login.ts')).toEqual(['auth'])
    expect(fileOwners(model, 'src/other/x.ts')).toEqual([])
  })

  it('dirtyReport 输出"旧路径(原属模块)→ 新路径"', () => {
    const store = { root: tmp, dir: '', config: DEFAULT_CONFIG, snapshots: [], model } as Store
    const report = dirtyReport(store, ['src/core/auth/login.ts'], 'test', [
      { from: 'src/auth/login.ts', to: 'src/core/auth/login.ts' },
    ])
    expect(report).toContain('迁移线索 (1)')
    expect(report).toContain('src/auth/login.ts(原属 auth) → src/core/auth/login.ts')
  })
})
