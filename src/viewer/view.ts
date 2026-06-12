import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyChanges, type SnapshotChanges } from '../analysis/diff.js'
import { emptyModel } from '../core/model.js'
import { applyPatch } from '../core/patch.js'
import type { Model, Snapshot } from '../core/types.js'
import { toPosix } from '../core/util.js'

export interface ViewSnapshot {
  snapshot: number
  date: string
  kind: string
  title: string
  story: string
  commits: string[]
  no_change: string[]
  changes: SnapshotChanges
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
  /** 实时服务模式:页面订阅 /events 自动刷新 */
  live?: boolean
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
  const templatePath = fileURLToPath(new URL('../../templates/viewer.html', import.meta.url))
  const template = fs.readFileSync(templatePath, 'utf8')
  // JSON 里的 < 转义,防止 </script> 截断
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return template.replace('"__ARCHMAP_DATA__"', json)
}
