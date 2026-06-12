import fs from 'node:fs'
import path from 'node:path'

// marker 幂等安装,与用户已有 hook 内容共存(做法借自 codegraph)
const BEGIN = '# >>> archmap check >>>'
const END = '# <<< archmap check <<<'
const BLOCK = `${BEGIN}
# commit 后检查是否有未记录的架构变更(只提醒,不阻塞,archmap 不在 PATH 时静默跳过)
command -v archmap >/dev/null 2>&1 && archmap check || true
${END}
`

export function stripBlock(content: string): string {
  const out: string[] = []
  let inBlock = false
  for (const line of content.split('\n')) {
    if (line.trim() === BEGIN) {
      inBlock = true
      continue
    }
    if (line.trim() === END) {
      inBlock = false
      continue
    }
    if (!inBlock) out.push(line)
  }
  return out.join('\n')
}

export type HookInstallResult = 'installed' | 'no-git'

export function installCheckHook(root: string): HookInstallResult {
  const hooksDir = path.join(root, '.git', 'hooks')
  if (!fs.existsSync(hooksDir)) return 'no-git'
  const hook = path.join(hooksDir, 'post-commit')
  let content = fs.existsSync(hook) ? fs.readFileSync(hook, 'utf8') : '#!/bin/sh\n'
  content = stripBlock(content)
  if (!content.endsWith('\n')) content += '\n'
  fs.writeFileSync(hook, content + BLOCK, { mode: 0o755 })
  return 'installed'
}

export type HookRemoveResult = 'removed' | 'absent'

export function removeCheckHook(root: string): HookRemoveResult {
  const hook = path.join(root, '.git', 'hooks', 'post-commit')
  if (!fs.existsSync(hook)) return 'absent'
  const stripped = stripBlock(fs.readFileSync(hook, 'utf8'))
  if (stripped.trim() === '' || stripped.trim() === '#!/bin/sh') {
    fs.rmSync(hook) // 只剩我们写的壳,整个删掉
  } else {
    fs.writeFileSync(hook, stripped, { mode: 0o755 })
  }
  return 'removed'
}
