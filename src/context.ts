import picomatch from 'picomatch'
import { walkModules } from './model.js'
import type { Feature, Model, ModuleNode, Snapshot } from './types.js'
import { toPosix } from './util.js'

const HIT_THRESHOLD = 20
const MAX_MODULES = 4
const MAX_FEATURES = 6
const MAX_FILES_PER_MODULE = 12

function cjkBigrams(s: string): Set<string> {
  const chars = [...s].filter((c) => /[一-鿿]/.test(c))
  const out = new Set<string>()
  for (let i = 0; i < chars.length - 1; i++) out.add(chars[i] + chars[i + 1])
  return out
}

function asciiTokens(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z0-9_$./-]{3,}/g) ?? []).map((t) => t.replace(/^[./]+|[./]+$/g, '')))
}

/**
 * 任务文本对节点打分:名字整词命中 > id 命中 > 锚点路径段命中 > 摘要二元组重叠。
 * 无 LLM,纯字符串信号,宁缺勿滥(低分节点宁可走全景兜底)。
 */
export function scoreNode(
  task: string,
  taskLower: string,
  tBigrams: Set<string>,
  tTokens: Set<string>,
  node: { id: string; name: string; summary: string; anchors: string[] },
): number {
  let sc = 0
  if (node.name.length >= 2 && task.includes(node.name)) sc += 50
  const core = node.id.replace(/^feat-/, '').toLowerCase()
  if (tTokens.has(node.id.toLowerCase()) || tTokens.has(core)) sc += 30
  else if (core.length >= 4 && taskLower.includes(core)) sc += 25
  for (const a of node.anchors) {
    let hit = false
    for (const seg of toPosix(a).split('/')) {
      const s = seg.replace(/[*#]/g, '').toLowerCase()
      if (s.length >= 3 && tTokens.has(s)) {
        hit = true
        break
      }
    }
    if (hit) {
      sc += 12
      break
    }
  }
  const bg = cjkBigrams(node.name + node.summary)
  let overlap = 0
  for (const b of bg) if (tBigrams.has(b)) overlap++
  sc += Math.min(20, overlap * 4)
  return sc
}

function anchoredFiles(anchors: string[], files: string[] | null): { list: string[]; total: number } {
  if (!files || anchors.length === 0) return { list: [], total: 0 }
  const matchers = anchors.map((a) => picomatch(toPosix(a.split('#')[0]), { dot: true }))
  const hits = files.filter((f) => matchers.some((m) => m(f)))
  return { list: hits.slice(0, MAX_FILES_PER_MODULE), total: hits.length }
}

function lastTouch(snapshots: Snapshot[], id: string): Snapshot | null {
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const p = snapshots[i].patch
    const ids = new Set<string>()
    for (const op of p) {
      if (op.op === 'add_module') ids.add(op.module.id)
      else if (op.op === 'add_feature') ids.add(op.feature.id)
      else if (op.op === 'update_anchors') ids.add(op.target)
      else if (op.op === 'add_relation' || op.op === 'remove_relation') ids.add(op.from)
      else if ('id' in op) ids.add(op.id)
    }
    if (ids.has(id)) return snapshots[i]
  }
  return null
}

/** 开工前的地图切片:任务 → 相关功能/模块/辖区文件/最近变动 */
export function buildContextReport(
  model: Model,
  snapshots: Snapshot[],
  task: string,
  files: string[] | null,
): string {
  const taskLower = task.toLowerCase()
  const tBigrams = cjkBigrams(task)
  const tTokens = asciiTokens(task)
  const sc = (n: { id: string; name: string; summary: string; anchors: string[] }) =>
    scoreNode(task, taskLower, tBigrams, tTokens, n)

  const moduleHits: { m: ModuleNode; trail: string[]; score: number }[] = []
  const trailOf: Record<string, string[]> = {}
  walkModules(model, (m, parent) => {
    trailOf[m.id] = parent ? [...(trailOf[parent.id] ?? []), parent.name] : []
    if (m.status === 'deprecated') return
    const s = sc(m)
    if (s >= HIT_THRESHOLD) moduleHits.push({ m, trail: trailOf[m.id], score: s })
  })
  moduleHits.sort((a, b) => b.score - a.score)

  const featureHits = model.features
    .filter((f) => f.status === 'active')
    .map((f) => ({ f, score: sc(f) }))
    .filter((x) => x.score >= HIT_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FEATURES)

  // 功能命中的模块也纳入
  const includeIds = new Set(moduleHits.slice(0, MAX_MODULES).map((x) => x.m.id))
  for (const { f } of featureHits) for (const mid of f.modules) includeIds.add(mid)
  const included: { m: ModuleNode; trail: string[] }[] = []
  walkModules(model, (m) => {
    if (includeIds.has(m.id)) included.push({ m, trail: trailOf[m.id] })
  })

  const lines: string[] = []
  const nameOf = (id: string): string => {
    let name = id
    walkModules(model, (m) => {
      if (m.id === id) name = m.name
    })
    const f = model.features.find((x) => x.id === id)
    return f ? f.name : name
  }

  if (!included.length && !featureHits.length) {
    // 兜底:全景概览
    lines.push(`任务未命中具体节点,给出全景概览(可在任务描述里带上模块名/文件路径以便精确切片):\n`)
    for (const m of model.modules.filter((x) => x.status === 'active')) {
      lines.push(`- ${m.name} (${m.id}):${m.summary}${m.children.length ? `,含 ${m.children.length} 个子模块` : ''}`)
    }
    lines.push(`\n功能共 ${model.features.filter((f) => f.status === 'active').length} 个,详见 .archmap/model.yaml`)
    return lines.join('\n')
  }

  if (featureHits.length) {
    lines.push('## 相关功能')
    for (const { f } of featureHits) {
      lines.push(`- ${f.name} (${f.id}):${f.summary}|落在模块: ${f.modules.map(nameOf).join('、')}|引入于快照 #${f.since}`)
    }
    lines.push('')
  }
  if (included.length) {
    lines.push('## 相关模块')
    for (const { m, trail } of included) {
      lines.push(`### ${trail.length ? trail.join(' ▸ ') + ' ▸ ' : ''}${m.name} (${m.id})`)
      lines.push(`职责:${m.summary}`)
      const af = anchoredFiles(m.anchors, files)
      if (m.anchors.length) {
        lines.push(`辖区:${m.anchors.join(', ')}${af.total ? `|文件 ${af.total} 个${af.total > af.list.length ? `,前 ${af.list.length} 个` : ''}: ${af.list.join(', ')}` : ''}`)
      }
      for (const r of m.relations) lines.push(`关系:—${r.kind}→ ${nameOf(r.to)}(${r.summary})`)
      const feats = model.features.filter((f) => f.status === 'active' && f.modules.includes(m.id))
      if (feats.length) lines.push(`承载功能:${feats.map((f) => f.name).join('、')}`)
      const lt = lastTouch(snapshots, m.id)
      if (lt) lines.push(`最近变动:#${String(lt.snapshot).padStart(4, '0')} ${lt.title}(${lt.date})`)
      lines.push('')
    }
  }
  lines.push('建议:先读上述辖区文件再动手;完成并过门禁后,用 archmap_dirty 算脏集、archmap_patch 记快照。')
  return lines.join('\n')
}
