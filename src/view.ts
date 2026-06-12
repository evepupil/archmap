import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { emptyModel } from './model.js'
import { applyPatch } from './patch.js'
import type { Model, PatchOp, Snapshot } from './types.js'
import { toPosix } from './util.js'

export interface ViewChanges {
  added: string[]
  modified: string[]
  deprecated: string[]
}

export interface ViewSnapshot {
  snapshot: number
  date: string
  kind: string
  title: string
  story: string
  commits: string[]
  no_change: string[]
  changes: ViewChanges
}

export interface ViewData {
  project: string
  root: string
  generatedAt: string
  snapshots: ViewSnapshot[]
  /** models[i] = 第 i 个快照应用后的模型状态,与 snapshots 一一对应 */
  models: Model[]
  /** 节点 id → 引入它的快照号 */
  since: Record<string, number>
}

/** 从补丁操作归类本快照的变化:新增 > 废弃 > 修改,互斥 */
export function classifyChanges(patch: PatchOp[]): ViewChanges {
  const added = new Set<string>()
  const deprecated = new Set<string>()
  const modified = new Set<string>()
  for (const op of patch) {
    switch (op.op) {
      case 'add_module':
        added.add(op.module.id)
        break
      case 'add_feature':
        added.add(op.feature.id)
        break
      case 'deprecate_module':
      case 'deprecate_feature':
        deprecated.add(op.id)
        break
      case 'update_module':
      case 'update_feature':
      case 'move_module':
        modified.add(op.id)
        break
      case 'update_anchors':
        modified.add(op.target)
        break
      case 'add_relation':
      case 'remove_relation':
        modified.add(op.from)
        break
    }
  }
  for (const id of added) {
    modified.delete(id)
    deprecated.delete(id)
  }
  for (const id of deprecated) modified.delete(id)
  return { added: [...added].sort(), modified: [...modified].sort(), deprecated: [...deprecated].sort() }
}

export function buildViewData(root: string, snapshots: Snapshot[]): ViewData {
  const sorted = [...snapshots].sort((a, b) => a.snapshot - b.snapshot)
  const models: Model[] = []
  const viewSnaps: ViewSnapshot[] = []
  const since: Record<string, number> = {}
  let model = emptyModel()
  for (const snap of sorted) {
    model = applyPatch(model, snap.patch, snap.snapshot).model
    models.push(model)
    const changes = classifyChanges(snap.patch)
    for (const id of changes.added) {
      if (!(id in since)) since[id] = snap.snapshot
    }
    viewSnaps.push({
      snapshot: snap.snapshot,
      date: snap.date,
      kind: snap.kind,
      title: snap.title,
      story: snap.story,
      commits: snap.commits,
      no_change: snap.no_change,
      changes,
    })
  }
  return {
    project: path.basename(root),
    root: toPosix(root),
    generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    snapshots: viewSnaps,
    models,
    since,
  }
}

/** 把数据注入模板,产出自包含的单文件 HTML */
export function renderViewerHtml(data: ViewData): string {
  const templatePath = fileURLToPath(new URL('../templates/viewer.html', import.meta.url))
  const template = fs.readFileSync(templatePath, 'utf8')
  // JSON 里的 < 转义,防止 </script> 截断
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return template.replace('"__ARCHMAP_DATA__"', json)
}
