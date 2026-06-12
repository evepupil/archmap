import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  - ".git/**"
  - ".gitignore"
gate:
  require_on: [feat]       # 哪类 commit 强制要求快照(目前仅提醒,不阻塞)
`

const EMPTY_MODEL = `version: 1
modules: []
features: []
`

export interface InitResult {
  created: string[]
  skipped: string[]
}

export function initProject(root: string): InitResult {
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

  // 把快照工作流的 skill 装进目标项目,AI 工具(Claude Code 等)即可识别
  const templateDir = fileURLToPath(new URL('../templates', import.meta.url))
  const skillSrc = path.join(templateDir, 'SKILL.md')
  if (fs.existsSync(skillSrc)) {
    writeIfAbsent(
      path.join(root, '.claude', 'skills', 'archmap-snapshot', 'SKILL.md'),
      fs.readFileSync(skillSrc, 'utf8'),
    )
  }

  return { created, skipped }
}
