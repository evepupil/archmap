import picomatch from 'picomatch'
import { findFeature, findModule, walkModules } from './model.js'
import { applyPatch } from './patch.js'
import type { ArchmapConfig, Model, PatchOp, SnapshotDraft, Violation } from './types.js'
import { countChars, countStoryChars, isKebabCase, toPosix } from './util.js'

const KINDS = new Set(['init', 'feature', 'fix-confirm', 'refactor', 'audit'])
const RELATION_KINDS = new Set(['calls', 'depends', 'stores', 'notifies'])

const DRAFT_KEYS = new Set(['kind', 'title', 'story', 'patch', 'commits', 'dirty_checked', 'no_change'])
const RELATION_KEYS = new Set(['to', 'kind', 'summary'])
const OP_KEYS: Record<string, Set<string>> = {
  add_module: new Set(['op', 'parent', 'module']),
  update_module: new Set(['op', 'id', 'set']),
  move_module: new Set(['op', 'id', 'parent']),
  update_anchors: new Set(['op', 'target', 'anchors']),
  add_relation: new Set(['op', 'from', 'relation']),
  remove_relation: new Set(['op', 'from', 'to', 'kind']),
  deprecate_module: new Set(['op', 'id']),
  add_feature: new Set(['op', 'feature']),
  update_feature: new Set(['op', 'id', 'set']),
  deprecate_feature: new Set(['op', 'id']),
}
const NESTED_KEYS: Record<string, Record<string, Set<string>>> = {
  add_module: { module: new Set(['id', 'name', 'summary', 'anchors', 'relations']) },
  update_module: { set: new Set(['name', 'summary']) },
  add_relation: { relation: RELATION_KEYS },
  add_feature: { feature: new Set(['id', 'name', 'summary', 'modules', 'anchors']) },
  update_feature: { set: new Set(['name', 'summary', 'modules']) },
}

function bannedHits(text: string, banned: string[]): string[] {
  return banned.filter((w) => w && text.includes(w))
}

function checkKeys(obj: unknown, allowed: Set<string>, at: string, v: Violation[]): void {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) {
    v.push({ path: at, message: '必须是对象' })
    return
  }
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k))
      v.push({ path: at, message: `未知字段: ${k}(常见原因:YAML 换行写岔,内容串成了新键)` })
  }
}

function checkRelations(relations: unknown, at: string, v: Violation[]): void {
  if (relations === undefined) return
  if (!Array.isArray(relations)) {
    v.push({ path: at, message: '必须是数组' })
    return
  }
  relations.forEach((r, i) => {
    checkKeys(r, RELATION_KEYS, `${at}[${i}]`, v)
    const kind = (r as Record<string, unknown>)?.kind
    if (typeof kind === 'string' && !RELATION_KINDS.has(kind))
      v.push({ path: `${at}[${i}].kind`, message: `非法关系类型: ${kind}(可选 calls/depends/stores/notifies)` })
  })
}

/** 草稿的形状严格校验:未知字段一律打回,拦住 YAML 写岔的串行键 */
function validateShape(draft: SnapshotDraft, v: Violation[]): void {
  checkKeys(draft, DRAFT_KEYS, 'draft', v)
  if (!Array.isArray(draft.patch)) return
  draft.patch.forEach((op, i) => {
    const at = `patch[${i}]`
    const opName = (op as { op?: unknown }).op
    if (typeof opName !== 'string' || !(opName in OP_KEYS)) {
      v.push({ path: at, message: `未知操作: ${String(opName)}` })
      return
    }
    checkKeys(op, OP_KEYS[opName], at, v)
    for (const [field, allowed] of Object.entries(NESTED_KEYS[opName] ?? {})) {
      const nested = (op as Record<string, unknown>)[field]
      if (nested !== undefined) {
        checkKeys(nested, allowed, `${at}.${field}`, v)
        if (field === 'module')
          checkRelations((nested as Record<string, unknown>).relations, `${at}.${field}.relations`, v)
        if (field === 'relation') {
          const kind = (nested as Record<string, unknown>).kind
          if (typeof kind === 'string' && !RELATION_KINDS.has(kind))
            v.push({ path: `${at}.${field}.kind`, message: `非法关系类型: ${kind}(可选 calls/depends/stores/notifies)` })
        }
      }
    }
  })
}

/**
 * 校验一份快照草稿。
 * fileList 为 null 时跳过锚点存在性检查(非 git 环境或测试)。
 */
export function validateDraft(
  draft: SnapshotDraft,
  model: Model,
  config: ArchmapConfig,
  fileList: string[] | null,
  nextSnapshotNum: number,
): Violation[] {
  const v: Violation[] = []
  const b = config.budgets
  const banned = config.banned_words

  // —— 形状严格校验:未知字段直接打回 ——
  validateShape(draft, v)
  if (v.length) return v

  // —— 草稿自身的形状与预算 ——
  if (!KINDS.has(draft.kind)) v.push({ path: 'kind', message: `非法 kind: ${String(draft.kind)}` })
  if (!draft.title?.trim()) v.push({ path: 'title', message: 'title 不能为空' })
  if (!draft.story?.trim()) v.push({ path: 'story', message: 'story 不能为空' })
  if (!Array.isArray(draft.patch)) v.push({ path: 'patch', message: 'patch 必须是数组(可为空)' })

  if (draft.title && countChars(draft.title) > b.title)
    v.push({ path: 'title', message: `超出预算: ${countChars(draft.title)} 字 > ${b.title} 字` })
  if (draft.story && countStoryChars(draft.story) > b.story)
    v.push({ path: 'story', message: `超出预算: ${countStoryChars(draft.story)} 字 > ${b.story} 字(不计空白)` })
  for (const field of ['title', 'story'] as const) {
    const hits = bannedHits(draft[field] ?? '', banned)
    if (hits.length) v.push({ path: field, message: `命中黑话黑名单: ${hits.join('、')}` })
  }
  if (draft.kind === 'feature' && (draft.patch?.length ?? 0) === 0)
    v.push({ path: 'patch', message: 'kind=feature 的快照补丁不应为空;无架构变化请用 fix-confirm' })

  if (v.length) return v // 形状都不对,后面不必查了

  // —— 补丁可应用性 ——
  let applied: { model: Model; touched: string[] }
  try {
    applied = applyPatch(model, draft.patch, nextSnapshotNum)
  } catch (e) {
    v.push({ path: 'patch', message: (e as Error).message })
    return v
  }
  const { model: next, touched } = applied

  // —— 新 id 的格式 ——
  for (const op of draft.patch) {
    const newId =
      op.op === 'add_module' ? op.module.id : op.op === 'add_feature' ? op.feature.id : null
    if (newId && !isKebabCase(newId))
      v.push({ path: `patch.${op.op}`, message: `id 必须是 kebab-case: ${newId}` })
  }

  // —— 触碰节点的字段预算与黑名单 ——
  const touchedSet = new Set(touched)
  walkModules(next, (node) => {
    if (!touchedSet.has(node.id)) return
    const at = `modules[${node.id}]`
    if (countChars(node.name) > b.name)
      v.push({ path: `${at}.name`, message: `超出预算: ${countChars(node.name)} 字 > ${b.name} 字` })
    if (countChars(node.summary) > b.module_summary)
      v.push({ path: `${at}.summary`, message: `超出预算: ${countChars(node.summary)} 字 > ${b.module_summary} 字` })
    for (const r of node.relations) {
      if (countChars(r.summary) > b.relation_summary)
        v.push({ path: `${at}.relations[${r.to}]`, message: `超出预算: ${countChars(r.summary)} 字 > ${b.relation_summary} 字` })
    }
    for (const field of ['name', 'summary'] as const) {
      const hits = bannedHits(node[field], banned)
      if (hits.length) v.push({ path: `${at}.${field}`, message: `命中黑话黑名单: ${hits.join('、')}` })
    }
  })
  for (const f of next.features) {
    if (!touchedSet.has(f.id)) continue
    const at = `features[${f.id}]`
    if (countChars(f.name) > b.name)
      v.push({ path: `${at}.name`, message: `超出预算: ${countChars(f.name)} 字 > ${b.name} 字` })
    if (countChars(f.summary) > b.feature_summary)
      v.push({ path: `${at}.summary`, message: `超出预算: ${countChars(f.summary)} 字 > ${b.feature_summary} 字` })
    for (const field of ['name', 'summary'] as const) {
      const hits = bannedHits(f[field], banned)
      if (hits.length) v.push({ path: `${at}.${field}`, message: `命中黑话黑名单: ${hits.join('、')}` })
    }
  }

  // —— 应用后的全局结构预算 ——
  const activeTop = next.modules.filter((m) => m.status === 'active')
  if (activeTop.length > b.top_level_modules)
    v.push({
      path: 'modules',
      message: `顶层模块 ${activeTop.length} 个 > 预算 ${b.top_level_modules} 个;先提交合并归类的补丁`,
    })
  walkModules(next, (node, _parent, depth) => {
    if (depth > b.max_depth)
      v.push({ path: `modules[${node.id}]`, message: `层深 ${depth} > 预算 ${b.max_depth}` })
    const activeChildren = node.children.filter((c) => c.status === 'active')
    if (activeChildren.length > b.children_per_level)
      v.push({
        path: `modules[${node.id}]`,
        message: `子模块 ${activeChildren.length} 个 > 预算 ${b.children_per_level} 个;先提交合并归类的补丁`,
      })
  })

  // —— 锚点存在性 ——
  if (fileList) {
    const files = fileList.map(toPosix)
    const checkAnchors = (at: string, anchors: string[]) => {
      for (const anchor of anchors) {
        const filePart = anchor.split('#')[0]
        const isMatch = picomatch(filePart, { dot: true })
        if (!files.some((f) => isMatch(f)))
          v.push({ path: at, message: `锚点没有命中任何文件: ${anchor}` })
      }
    }
    walkModules(next, (node) => {
      if (touchedSet.has(node.id)) checkAnchors(`modules[${node.id}].anchors`, node.anchors)
    })
    for (const f of next.features) {
      if (touchedSet.has(f.id)) checkAnchors(`features[${f.id}].anchors`, f.anchors)
    }
  }

  // —— dirty_checked / no_change 引用检查 ——
  const checked = draft.dirty_checked ?? []
  const noChange = draft.no_change ?? []
  for (const id of [...checked, ...noChange]) {
    if (!findModule(next, id) && !findFeature(next, id))
      v.push({ path: 'dirty_checked', message: `引用了不存在的节点: ${id}` })
  }
  const checkedSet = new Set(checked)
  for (const id of noChange) {
    if (!checkedSet.has(id))
      v.push({ path: 'no_change', message: `no_change 必须是 dirty_checked 的子集: ${id}` })
  }

  return v
}

/** 校验已落盘快照的 base 链:必须基于上一个快照 */
export function validateBase(base: number, lastSnapshotNum: number): Violation[] {
  if (base !== lastSnapshotNum)
    return [
      {
        path: 'base',
        message: `base=${base} 与当前最新快照 ${lastSnapshotNum} 不符;先同步再提交`,
      },
    ]
  return []
}

export function formatViolations(violations: Violation[]): string {
  return violations.map((x) => `  ✗ ${x.path}: ${x.message}`).join('\n')
}
