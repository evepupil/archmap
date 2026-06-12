#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import { parse } from 'yaml'
import { computeDirty } from './analysis/dirty.js'
import {
  changedFilesInRange,
  commitSubjectsSince,
  isGitRepo,
  renamesInRange,
  renamesSince,
  type Rename,
} from './store/git.js'
import { installCheckHook, removeCheckHook } from './setup/hooks.js'
import { initProject } from './setup/init.js'
import { serializeModel } from './core/model.js'
import { replay } from './core/patch.js'
import { dirtyReport, statusReport } from './analysis/reports.js'
import {
  applyDraft,
  changedSinceLastSnapshot,
  findRoot,
  lastSnapshotSha,
  loadStore,
  writeModel,
  type Store,
} from './store/snapshot.js'
import { McpEngine, runStdioServer } from './mcp/engine.js'
import type { SnapshotDraft } from './core/types.js'
import { ArchmapError, toPosix, VERSION } from './core/util.js'
import { formatViolations } from './core/validate.js'
import { startViewerServer } from './viewer/serve.js'
import { buildViewData, renderViewerHtml } from './viewer/view.js'

const program = new Command()

function requireStore(): Store {
  const root = findRoot(process.cwd())
  if (!root) {
    console.error('当前目录及其上层都没有 .archmap/。先运行 archmap init')
    process.exit(1)
  }
  return loadStore(root)
}

function readDraft(file: string): SnapshotDraft {
  if (!fs.existsSync(file)) throw new ArchmapError(`草稿文件不存在: ${file}`)
  return parse(fs.readFileSync(file, 'utf8')) as SnapshotDraft
}

program
  .name('archmap')
  .description('架构与功能层面的、AI 自动维护的、带时间线的项目地图')
  .version(VERSION)

program
  .command('init')
  .argument('[path]', '项目根目录', '.')
  .description('初始化 .archmap/ 并安装 archmap-snapshot skill')
  .action((p: string) => {
    const root = path.resolve(p)
    const r = initProject(root)
    for (const f of r.created) console.log(`  + ${f}`)
    for (const f of r.skipped) console.log(`  = ${f} (已存在,跳过)`)
    console.log(
      r.hook === 'installed'
        ? '  + post-commit 提醒钩子已安装(只提醒,不阻塞)'
        : '  ! 非 git 仓库,提醒钩子未安装',
    )
    if (r.codex) console.log('  + 检测到 Codex,skill 已同步投放到 .codex/skills/')
    console.log('\n下一步:让 AI 执行 /archmap-snapshot 完成首次建图')
  })

program
  .command('hook')
  .option('--remove', '移除 post-commit 提醒钩子')
  .description('安装/移除 post-commit 提醒钩子(archmap check)')
  .action((opts: { remove?: boolean }) => {
    const store = requireStore()
    if (opts.remove) {
      const r = removeCheckHook(store.root)
      console.log(r === 'removed' ? '已移除' : '本来就没有')
    } else {
      const r = installCheckHook(store.root)
      console.log(r === 'installed' ? '已安装到 .git/hooks/post-commit' : '非 git 仓库,无法安装')
    }
  })

program
  .command('dirty')
  .option('--range <a..b>', '指定 commit 区间;默认自上个快照到工作区')
  .option('--json', '机器可读输出')
  .description('计算脏模块/脏功能/无主文件')
  .action((opts: { range?: string; json?: boolean }) => {
    const store = requireStore()
    let files: string[]
    let note: string
    let renames: Rename[]
    if (opts.range) {
      files = changedFilesInRange(store.root, opts.range)
      renames = renamesInRange(store.root, opts.range)
      note = opts.range
    } else {
      const r = changedSinceLastSnapshot(store)
      files = r.files
      renames = store.snapshots.length && isGitRepo(store.root) ? renamesSince(store.root, r.baseSha) : []
      note = r.baseSha ? `${r.baseSha}..工作区` : '全部文件(尚无快照基线)'
    }
    if (opts.json) {
      console.log(
        JSON.stringify(
          { ...computeDirty(store.model, files, store.config.unowned_ignore), renames },
          null,
          2,
        ),
      )
    } else {
      console.log(dirtyReport(store, files, note, renames))
    }
  })

program
  .command('validate')
  .argument('<draft>', '快照草稿 yaml')
  .description('只校验草稿,不落盘')
  .action((draftPath: string) => {
    const store = requireStore()
    const result = applyDraft(store, readDraft(draftPath), true)
    if (!result.ok) {
      console.error(`校验失败,共 ${result.violations.length} 条:`)
      console.error(formatViolations(result.violations))
      process.exit(1)
    }
    console.log(`校验通过。将成为快照 ${result.snapshot!.snapshot}`)
  })

program
  .command('apply')
  .argument('<draft>', '快照草稿 yaml')
  .option('--keep', '保留草稿文件')
  .description('校验并落盘快照,重放更新 model.yaml')
  .action((draftPath: string, opts: { keep?: boolean }) => {
    const store = requireStore()
    const result = applyDraft(store, readDraft(draftPath))
    if (!result.ok) {
      console.error(`校验失败,共 ${result.violations.length} 条:`)
      console.error(formatViolations(result.violations))
      process.exit(1)
    }
    if (!opts.keep) fs.rmSync(path.resolve(draftPath))
    const s = result.snapshot!
    console.log(`已写入快照 ${s.snapshot}: ${s.title}`)
    console.log(`  文件: ${toPosix(path.relative(store.root, result.file!))}`)
    console.log(`  关联 commit: ${s.commits.join(', ') || '(无)'}`)
    console.log('记得把 .archmap/ 的变更一起 commit')
  })

program
  .command('replay')
  .option('--check', '只比对,不写回')
  .description('从补丁流重放生成 model.yaml')
  .action((opts: { check?: boolean }) => {
    const store = requireStore()
    const rebuilt = replay(store.snapshots)
    const file = path.join(store.dir, 'model.yaml')
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    const fresh = serializeModel(rebuilt)
    if (current === fresh) {
      console.log('model.yaml 与补丁流一致')
      return
    }
    if (opts.check) {
      console.error('model.yaml 与补丁流不一致(可能被手改过),运行 archmap replay 重建')
      process.exit(1)
    }
    writeModel(store, rebuilt)
    console.log('已从补丁流重建 model.yaml')
  })

program
  .command('timeline')
  .description('按时间列出全部快照')
  .action(() => {
    const store = requireStore()
    if (store.snapshots.length === 0) {
      console.log('还没有快照')
      return
    }
    for (const s of store.snapshots) {
      console.log(`${String(s.snapshot).padStart(4, '0')}  ${s.date}  [${s.kind}] ${s.title}  (${s.patch.length} 个补丁, ${s.commits.length} 个 commit)`)
    }
  })

program
  .command('status')
  .description('地图健康度:快照数、锚点失效、覆盖率')
  .action(() => {
    console.log(statusReport(requireStore()))
  })

function openInBrowser(file: string): void {
  const cmd =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', file]]
      : process.platform === 'darwin'
        ? ['open', [file]]
        : ['xdg-open', [file]]
  spawn(cmd[0] as string, cmd[1] as string[], { detached: true, stdio: 'ignore' }).unref()
}

program
  .command('view')
  .option('--out <file>', '只导出静态 HTML 后退出,不起实时服务')
  .option('--port <n>', '实时服务端口(默认随机)')
  .option('--no-open', '不自动打开浏览器')
  .description('打开架构舆图;默认起本地实时服务,快照更新页面自动刷新')
  .action(async (opts: { out?: string; port?: string; open: boolean }) => {
    const store = requireStore()
    if (opts.out) {
      const html = renderViewerHtml(buildViewData(store.root, store.snapshots))
      const out = path.resolve(opts.out)
      fs.writeFileSync(out, html, 'utf8')
      console.log(`已导出: ${out}`)
      if (opts.open) openInBrowser(out)
      return
    }
    const { port } = await startViewerServer(store.root, opts.port ? Number(opts.port) : 0)
    const url = `http://127.0.0.1:${port}/`
    console.log(`实时舆图: ${url}`)
    console.log('快照变更页面自动刷新;Ctrl+C 退出')
    if (opts.open) openInBrowser(url)
  })

program
  .command('check')
  .description('gate 检查(只提醒不阻塞):有架构辖区变更但没记快照时给出提示')
  .action(() => {
    const store = requireStore()
    if (!isGitRepo(store.root)) {
      console.log('非 git 仓库,跳过检查')
      return
    }
    const baseSha = lastSnapshotSha(store)
    const { files } = changedSinceLastSnapshot(store)
    if (files.length === 0) {
      console.log('自上个快照以来无变更')
      return
    }
    const result = computeDirty(store.model, files, store.config.unowned_ignore)
    const subjects = commitSubjectsSince(store.root, baseSha)
    const prefixes = store.config.gate.require_on
    const hasGatedCommit = subjects.some((s) => prefixes.some((p) => s.startsWith(p)))
    if (result.dirtyModules.length || result.unowned.length || hasGatedCommit) {
      console.log('提醒:自上个快照以来有未记录的变更——')
      if (hasGatedCommit) console.log(`  - 存在 ${prefixes.join('/')} 开头的 commit`)
      if (result.dirtyModules.length) console.log(`  - 命中辖区的模块: ${result.dirtyModules.join(', ')}`)
      if (result.unowned.length) console.log(`  - 无主文件 ${result.unowned.length} 个`)
      console.log('建议执行 /archmap-snapshot 记录快照(本检查不阻塞任何操作)')
    } else {
      console.log('无需快照')
    }
  })

program
  .command('mcp')
  .description('以 MCP 服务器模式运行(stdio),供 AI 编程工具接入')
  .action(() => {
    runStdioServer(new McpEngine({ cwd: process.cwd(), version: VERSION, allow: process.env.ARCHMAP_MCP_TOOLS }))
  })

program
  .command('install')
  .argument('[path]', '项目根目录', '.')
  .description('把 archmap MCP 服务器注册到项目的 .mcp.json(Claude Code 项目级配置,幂等)')
  .action((p: string) => {
    const root = path.resolve(p)
    const file = path.join(root, '.mcp.json')
    let config: { mcpServers?: Record<string, unknown> } = {}
    if (fs.existsSync(file)) {
      try {
        config = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof config
      } catch {
        console.error(`${file} 不是合法 JSON,不动它;请手动合并 mcpServers.archmap`)
        process.exit(1)
      }
    }
    const entry =
      process.platform === 'win32'
        ? { command: 'cmd', args: ['/c', 'archmap', 'mcp'] }
        : { command: 'archmap', args: ['mcp'] }
    const prev = JSON.stringify(config.mcpServers?.archmap)
    config.mcpServers = { ...config.mcpServers, archmap: entry }
    if (prev === JSON.stringify(entry)) {
      console.log('.mcp.json 已是最新,无变化')
      return
    }
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8')
    console.log(`已写入 ${toPosix(path.relative(root, file))} —— 重启 Claude Code 会话后生效`)
    console.log('工具:archmap_context / archmap_dirty / archmap_patch / archmap_diff / archmap_status')
  })

program.parseAsync().catch((e: unknown) => {
  console.error(e instanceof ArchmapError ? e.message : e)
  process.exit(1)
})
