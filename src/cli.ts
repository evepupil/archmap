#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Command } from 'commander'
import picomatch from 'picomatch'
import { parse } from 'yaml'
import { computeDirty } from './dirty.js'
import { changedFilesInRange, commitSubjectsSince, isGitRepo, listProjectFiles } from './git.js'
import { initProject } from './init.js'
import { serializeModel, walkModules } from './model.js'
import { replay } from './patch.js'
import {
  applyDraft,
  changedSinceLastSnapshot,
  findRoot,
  lastSnapshot,
  lastSnapshotSha,
  loadStore,
  writeModel,
  type Store,
} from './snapshot.js'
import type { SnapshotDraft } from './types.js'
import { ArchmapError, toPosix } from './util.js'
import { formatViolations } from './validate.js'
import { buildViewData, renderViewerHtml } from './view.js'

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

function printDirty(store: Store, files: string[], baseNote: string): void {
  const result = computeDirty(store.model, files, store.config.unowned_ignore)
  console.log(`变更范围: ${baseNote},共 ${result.changed.length} 个文件`)
  console.log(`\n脏模块 (${result.dirtyModules.length}):`)
  for (const id of result.dirtyModules) console.log(`  - ${id}`)
  console.log(`\n脏功能 (${result.dirtyFeatures.length}):`)
  for (const id of result.dirtyFeatures) console.log(`  - ${id}`)
  console.log(`\n无主文件 (${result.unowned.length})${result.unowned.length ? ',必须收编或提案新模块:' : ':'}`)
  for (const f of result.unowned) console.log(`  - ${f}`)
}

program
  .name('archmap')
  .description('架构与功能层面的、AI 自动维护的、带时间线的项目地图')
  .version('0.1.0')

program
  .command('init')
  .argument('[path]', '项目根目录', '.')
  .description('初始化 .archmap/ 并安装 archmap-snapshot skill')
  .action((p: string) => {
    const root = path.resolve(p)
    const r = initProject(root)
    for (const f of r.created) console.log(`  + ${f}`)
    for (const f of r.skipped) console.log(`  = ${f} (已存在,跳过)`)
    console.log('\n下一步:让 AI 执行 /archmap-snapshot 完成首次建图')
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
    if (opts.range) {
      files = changedFilesInRange(store.root, opts.range)
      note = opts.range
    } else {
      const r = changedSinceLastSnapshot(store)
      files = r.files
      note = r.baseSha ? `${r.baseSha}..工作区` : '全部文件(尚无快照基线)'
    }
    if (opts.json) {
      console.log(JSON.stringify(computeDirty(store.model, files, store.config.unowned_ignore), null, 2))
    } else {
      printDirty(store, files, note)
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
    const store = requireStore()
    const last = lastSnapshot(store)
    let moduleCount = 0
    let featureCount = store.model.features.filter((f) => f.status === 'active').length
    const brokenAnchors: string[] = []
    const inGit = isGitRepo(store.root)
    const files = inGit ? listProjectFiles(store.root).map(toPosix) : null

    const anchorMatchers: ((f: string) => boolean)[] = []
    walkModules(store.model, (node) => {
      if (node.status === 'deprecated') return
      moduleCount++
      for (const a of node.anchors) {
        const m = picomatch(toPosix(a.split('#')[0]), { dot: true })
        anchorMatchers.push(m)
        if (files && !files.some((f) => m(f))) brokenAnchors.push(`${node.id}: ${a}`)
      }
    })

    console.log(`快照: ${store.snapshots.length} 个${last ? `,最新 ${last.snapshot}(${last.date} ${last.title})` : ''}`)
    console.log(`模块: ${moduleCount} 个(active),功能: ${featureCount} 个(active)`)
    if (files) {
      const ignore = store.config.unowned_ignore.map((p) => picomatch(p, { dot: true }))
      const candidates = files.filter((f) => !ignore.some((m) => m(f)))
      const covered = candidates.filter((f) => anchorMatchers.some((m) => m(f)))
      const pct = candidates.length ? Math.round((covered.length / candidates.length) * 100) : 0
      console.log(`锚点覆盖率: ${pct}% (${covered.length}/${candidates.length} 个文件,粗略口径)`)
    }
    if (brokenAnchors.length) {
      console.log(`失效锚点 (${brokenAnchors.length}),下次快照必须处理:`)
      for (const a of brokenAnchors) console.log(`  ✗ ${a}`)
    } else if (files) {
      console.log('锚点全部有效')
    }
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
  .option('--out <file>', '输出 HTML 路径(默认写到系统临时目录)')
  .option('--no-open', '只生成,不打开浏览器')
  .description('生成并打开架构舆图(自包含单文件 HTML)')
  .action((opts: { out?: string; open: boolean }) => {
    const store = requireStore()
    const html = renderViewerHtml(buildViewData(store.root, store.snapshots))
    const out = opts.out
      ? path.resolve(opts.out)
      : path.join(os.tmpdir(), `archmap-view-${path.basename(store.root)}.html`)
    fs.writeFileSync(out, html, 'utf8')
    console.log(`已生成: ${out}`)
    if (opts.open) openInBrowser(out)
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

program.parseAsync().catch((e: unknown) => {
  console.error(e instanceof ArchmapError ? e.message : e)
  process.exit(1)
})
