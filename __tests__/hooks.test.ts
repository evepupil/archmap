import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installCheckHook, removeCheckHook, stripBlock } from '../src/hooks.js'

let tmp: string
let hookFile: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archmap-hook-'))
  fs.mkdirSync(path.join(tmp, '.git', 'hooks'), { recursive: true })
  hookFile = path.join(tmp, '.git', 'hooks', 'post-commit')
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('installCheckHook', () => {
  it('新建 hook:shebang + marker 块', () => {
    expect(installCheckHook(tmp)).toBe('installed')
    const c = fs.readFileSync(hookFile, 'utf8')
    expect(c.startsWith('#!/bin/sh')).toBe(true)
    expect(c).toContain('# >>> archmap check >>>')
    expect(c).toContain('archmap check')
  })

  it('幂等:装两次只有一个块', () => {
    installCheckHook(tmp)
    installCheckHook(tmp)
    const c = fs.readFileSync(hookFile, 'utf8')
    expect(c.match(/>>> archmap check >>>/g)).toHaveLength(1)
  })

  it('保留用户已有的 hook 内容', () => {
    fs.writeFileSync(hookFile, '#!/bin/sh\necho mine\n')
    installCheckHook(tmp)
    const c = fs.readFileSync(hookFile, 'utf8')
    expect(c).toContain('echo mine')
    expect(c).toContain('archmap check')
  })

  it('非 git 仓库返回 no-git', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'archmap-nogit-'))
    expect(installCheckHook(bare)).toBe('no-git')
    fs.rmSync(bare, { recursive: true, force: true })
  })
})

describe('removeCheckHook', () => {
  it('只有我们的块时删除整个文件', () => {
    installCheckHook(tmp)
    expect(removeCheckHook(tmp)).toBe('removed')
    expect(fs.existsSync(hookFile)).toBe(false)
  })

  it('有用户内容时只剥离我们的块', () => {
    fs.writeFileSync(hookFile, '#!/bin/sh\necho mine\n')
    installCheckHook(tmp)
    removeCheckHook(tmp)
    const c = fs.readFileSync(hookFile, 'utf8')
    expect(c).toContain('echo mine')
    expect(c).not.toContain('archmap check')
  })

  it('stripBlock 往返安全', () => {
    const original = '#!/bin/sh\necho a\n'
    fs.writeFileSync(hookFile, original)
    installCheckHook(tmp)
    expect(stripBlock(fs.readFileSync(hookFile, 'utf8'))).toBe(original)
  })
})
