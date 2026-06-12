import path from 'node:path'
import { buildContextReport } from '../analysis/context.js'
import { diffRange } from '../analysis/diff.js'
import { changedFilesInRange, isGitRepo, listProjectFiles, renamesInRange, renamesSince } from '../store/git.js'
import { dirtyReport, statusReport } from '../analysis/reports.js'
import {
  applyDraft,
  changedSinceLastSnapshot,
  findRoot,
  lastSnapshot,
  loadStore,
  type Store,
} from '../store/snapshot.js'
import type { SnapshotDraft } from '../core/types.js'
import { ArchmapError, toPosix } from '../core/util.js'
import { formatViolations } from '../core/validate.js'

const MAX_INPUT_LENGTH = 10_000
const MAX_PATH_LENGTH = 4_096
export const MAX_OUTPUT_LENGTH = 15_000

const PROJECT_PATH_PROP = {
  projectPath: {
    type: 'string',
    maxLength: MAX_PATH_LENGTH,
    description: '其他已初始化项目的根目录;默认当前项目',
  },
} as const

export interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'archmap_context',
    description:
      '开工前查地图:输入开发任务描述,返回相关功能、模块、辖区文件清单和最近变动。先看切片再读代码,避免通读源码。',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          maxLength: MAX_INPUT_LENGTH,
          description: '任务描述,中英混合皆可;带上模块名/文件路径/功能名会更准',
        },
        ...PROJECT_PATH_PROP,
      },
      required: ['task'],
    },
  },
  {
    name: 'archmap_dirty',
    description:
      '计算脏集:这段改动碰了地图哪些辖区。返回脏模块、脏功能、无主文件(必须收编或提案新模块)。记快照前必调。',
    inputSchema: {
      type: 'object',
      properties: {
        range: {
          type: 'string',
          maxLength: 200,
          description: 'git 区间,如 abc123..HEAD;省略则取自上个快照到当前工作区(含未提交)',
        },
        ...PROJECT_PATH_PROP,
      },
      required: [],
    },
  },
  {
    name: 'archmap_patch',
    description:
      '提交架构快照:补丁 + 人话摘要,经校验后落盘并更新地图。校验失败会逐条返回 violation,修正后重试。无架构变化用 kind=fix-confirm + 空 patch。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['init', 'feature', 'fix-confirm', 'refactor', 'audit'] },
        title: { type: 'string', maxLength: 200, description: '≤20 字' },
        story: { type: 'string', maxLength: 4000, description: '人话摘要,≤200 字(不计空白),读者是三个月后的项目作者' },
        patch: {
          type: 'array',
          items: { type: 'object' },
          description:
            '补丁操作数组。op ∈ add_module{parent?,module:{id,name,summary,anchors?,relations?}} / update_module{id,set:{name?,summary?}} / move_module{id,parent} / update_anchors{target,anchors} / add_relation{from,relation:{to,kind,summary}} / remove_relation{from,to,kind?} / deprecate_module{id} / add_feature{feature:{id,name,summary,modules,anchors?}} / update_feature{id,set} / deprecate_feature{id}。关系 kind ∈ calls/depends/stores/notifies。未知字段会被打回。',
        },
        dirty_checked: { type: 'array', items: { type: 'string' }, description: '本次检查过的脏节点 id' },
        no_change: { type: 'array', items: { type: 'string' }, description: '其中确认无架构影响的(dirty_checked 子集)' },
        dry_run: { type: 'boolean', description: '只校验不落盘' },
        ...PROJECT_PATH_PROP,
      },
      required: ['kind', 'title', 'story', 'patch'],
    },
  },
  {
    name: 'archmap_diff',
    description: '两个快照之间的架构净变化:新增/修改/废弃/昙花(区间内出现又废弃),附区间快照列表。',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'number', description: '起点快照号(不含)' },
        to: { type: 'number', description: '终点快照号(含);省略取最新' },
        ...PROJECT_PATH_PROP,
      },
      required: ['from'],
    },
  },
  {
    name: 'archmap_status',
    description: '地图健康度:快照数、模块/功能数、锚点失效清单、覆盖率。',
    inputSchema: { type: 'object', properties: { ...PROJECT_PATH_PROP }, required: [] },
  },
]

/** ARCHMAP_MCP_TOOLS=context,patch 这种白名单(可带 archmap_ 前缀) */
export function filterTools(defs: ToolDef[], allowRaw: string | undefined): ToolDef[] {
  if (!allowRaw?.trim()) return defs
  const allow = new Set(
    allowRaw.split(',').map((s) => s.trim().replace(/^archmap_/, '')).filter(Boolean),
  )
  return defs.filter((d) => allow.has(d.name.replace(/^archmap_/, '')))
}

const SAFE_RANGE = /^[A-Za-z0-9_~^][A-Za-z0-9_.~^/-]*(\.\.\.?[A-Za-z0-9_.~^/-]+)?$/

function resolveStore(cwd: string, projectPath?: unknown): Store {
  if (projectPath !== undefined && typeof projectPath !== 'string')
    throw new ArchmapError('projectPath 必须是字符串')
  if (typeof projectPath === 'string' && projectPath.length > MAX_PATH_LENGTH)
    throw new ArchmapError('projectPath 过长')
  const start = projectPath ? path.resolve(projectPath) : cwd
  const root = findRoot(start)
  if (!root) throw new ArchmapError(`${start} 及其上层没有 .archmap/;先运行 archmap init`)
  return loadStore(root)
}

function str(v: unknown, field: string, max = MAX_INPUT_LENGTH): string {
  if (typeof v !== 'string' || !v.trim()) throw new ArchmapError(`${field} 必须是非空字符串`)
  if (v.length > max) throw new ArchmapError(`${field} 超长(>${max})`)
  return v
}

export async function callTool(name: string, args: Record<string, unknown>, cwd: string): Promise<string> {
  switch (name) {
    case 'archmap_context': {
      const store = resolveStore(cwd, args.projectPath)
      const task = str(args.task, 'task')
      const files = isGitRepo(store.root) ? listProjectFiles(store.root).map(toPosix) : null
      return buildContextReport(store.model, store.snapshots, task, files)
    }
    case 'archmap_dirty': {
      const store = resolveStore(cwd, args.projectPath)
      if (args.range !== undefined) {
        const range = str(args.range, 'range', 200)
        if (!SAFE_RANGE.test(range)) throw new ArchmapError(`非法 range: ${range}`)
        return dirtyReport(store, changedFilesInRange(store.root, range), range, renamesInRange(store.root, range))
      }
      const { baseSha, files } = changedSinceLastSnapshot(store)
      const renames = store.snapshots.length && isGitRepo(store.root) ? renamesSince(store.root, baseSha) : []
      return dirtyReport(store, files, baseSha ? `${baseSha}..工作区` : '全部文件(尚无快照基线)', renames)
    }
    case 'archmap_patch': {
      const store = resolveStore(cwd, args.projectPath)
      const draft: SnapshotDraft = {
        kind: args.kind as SnapshotDraft['kind'],
        title: str(args.title, 'title', 200),
        story: str(args.story, 'story', 4000),
        patch: Array.isArray(args.patch) ? (args.patch as SnapshotDraft['patch']) : ([] as never),
        ...(args.dirty_checked !== undefined ? { dirty_checked: args.dirty_checked as string[] } : {}),
        ...(args.no_change !== undefined ? { no_change: args.no_change as string[] } : {}),
      }
      const r = applyDraft(store, draft, args.dry_run === true)
      if (!r.ok) {
        throw new ArchmapError(`校验失败,共 ${r.violations.length} 条,修正后重试:\n${formatViolations(r.violations)}`)
      }
      const s = r.snapshot!
      if (args.dry_run === true) return `校验通过(dry_run,未落盘)。将成为快照 ${s.snapshot}`
      return [
        `已写入快照 ${s.snapshot}: ${s.title}`,
        `文件: ${toPosix(path.relative(store.root, r.file!))}`,
        `关联 commit: ${s.commits.join(', ') || '(无)'}`,
        '记得把 .archmap/ 的变更一起 commit。',
      ].join('\n')
    }
    case 'archmap_diff': {
      const store = resolveStore(cwd, args.projectPath)
      const last = lastSnapshot(store)?.snapshot ?? 0
      const from = typeof args.from === 'number' ? args.from : Number.NaN
      const to = args.to === undefined ? last : typeof args.to === 'number' ? args.to : Number.NaN
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > last || from >= to)
        throw new ArchmapError(`非法区间: from=${String(args.from)}, to=${String(args.to)}(最新快照 ${last})`)
      const d = diffRange(store.snapshots, from, to)
      const sec = (label: string, ids: string[]) =>
        ids.length ? `${label} (${ids.length}): ${ids.join(', ')}` : null
      return [
        `快照 #${from} → #${to} 的净变化:`,
        sec('新增', d.added),
        sec('修改', d.modified),
        sec('废弃', d.deprecated),
        sec('昙花(区间内出现又废弃)', d.ephemeral),
        d.added.length + d.modified.length + d.deprecated.length + d.ephemeral.length === 0
          ? '无架构变化'
          : null,
        '',
        '区间快照:',
        ...d.perSnapshot.map((s) => `  #${String(s.snapshot).padStart(4, '0')} ${s.date} [${s.kind}] ${s.title}`),
      ]
        .filter((x): x is string => x !== null)
        .join('\n')
    }
    case 'archmap_status': {
      return statusReport(resolveStore(cwd, args.projectPath))
    }
    default:
      throw new ArchmapError(`未知工具: ${name}`)
  }
}

export function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_LENGTH) return text
  return text.slice(0, MAX_OUTPUT_LENGTH) + '\n…(输出超长已截断)'
}
