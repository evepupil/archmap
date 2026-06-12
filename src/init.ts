import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installCheckHook, type HookInstallResult } from './hooks.js'

const CONFIG_TEMPLATE = `# archmap 配置。预算是硬约束,校验器按这里执行。
language: zh
reader: 三个月后忘光了细节的项目作者
budgets:
  name: 12                 # 模块/功能名
  module_summary: 40
  feature_summary: 40
  relation_summary: 30
  title: 20                # 快照标题
  story: 200               # 快照人话摘要(不计空白)
  top_level_modules: 9     # 顶层永远一屏
  children_per_level: 9
  max_depth: 3
banned_words: []           # 黑话黑名单,命中即打回。示例: [赋能, 抓手, 顶层设计]
unowned_ignore:            # 这些文件不参与"无主文件"判定
  - ".archmap/**"
  - ".claude/**"
  - ".codex/**"
  - ".git/**"
  - ".gitignore"
gate:
  require_on: [feat]       # 哪类 commit 强制要求快照(目前仅提醒,不阻塞)
`

const EMPTY_MODEL = `version: 1
modules: []
features: []
`

const SKILLS = [
  { template: 'SKILL.md', name: 'archmap-snapshot' },
  { template: 'AUDIT_SKILL.md', name: 'archmap-audit' },
]

export interface InitResult {
  created: string[]
  skipped: string[]
  hook: HookInstallResult
  codex: boolean
}

export function initProject(root: string, opts: { home?: string } = {}): InitResult {
  const created: string[] = []
  const skipped: string[] = []
  const dir = path.join(root, '.archmap')

  const writeIfAbsent = (file: string, content: string) => {
    if (fs.existsSync(file)) {
      skipped.push(path.relative(root, file))
      return
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content, 'utf8')
    created.push(path.relative(root, file))
  }

  writeIfAbsent(path.join(dir, 'config.yaml'), CONFIG_TEMPLATE)
  writeIfAbsent(path.join(dir, 'model.yaml'), EMPTY_MODEL)
  fs.mkdirSync(path.join(dir, 'snapshots'), { recursive: true })
  writeIfAbsent(path.join(dir, 'snapshots', '.gitkeep'), '')

  // 把工作流 skill 装进目标项目;装了 Codex 的同时投放到它的项目级目录
  const home = opts.home ?? os.homedir()
  const codex = fs.existsSync(path.join(home, '.codex'))
  const templateDir = fileURLToPath(new URL('../templates', import.meta.url))
  for (const s of SKILLS) {
    const src = path.join(templateDir, s.template)
    if (!fs.existsSync(src)) continue
    const content = fs.readFileSync(src, 'utf8')
    writeIfAbsent(path.join(root, '.claude', 'skills', s.name, 'SKILL.md'), content)
    if (codex) writeIfAbsent(path.join(root, '.codex', 'skills', s.name, 'SKILL.md'), content)
  }

  const hook = installCheckHook(root)
  return { created, skipped, hook, codex }
}
