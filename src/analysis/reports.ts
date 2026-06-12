import picomatch from 'picomatch'
import { computeDirty, fileOwners } from './dirty.js'
import { isGitRepo, listProjectFiles, type Rename } from '../store/git.js'
import { walkModules } from '../core/model.js'
import { lastSnapshot, type Store } from '../store/snapshot.js'
import type { Model } from '../core/types.js'
import { toPosix } from '../core/util.js'

function nameOf(model: Model, id: string): string {
  let name = id
  walkModules(model, (m) => {
    if (m.id === id) name = m.name
  })
  const f = model.features.find((x) => x.id === id)
  return f ? `${f.name}` : name
}

export function dirtyReport(store: Store, files: string[], note: string, renames: Rename[] = []): string {
  const r = computeDirty(store.model, files, store.config.unowned_ignore)
  const lines = [`变更范围: ${note},共 ${r.changed.length} 个文件`]
  lines.push(`\n脏模块 (${r.dirtyModules.length}):`)
  for (const id of r.dirtyModules) lines.push(`  - ${id}(${nameOf(store.model, id)})`)
  lines.push(`\n脏功能 (${r.dirtyFeatures.length}):`)
  for (const id of r.dirtyFeatures) lines.push(`  - ${id}(${nameOf(store.model, id)})`)
  lines.push(`\n无主文件 (${r.unowned.length})${r.unowned.length ? ',必须收编进现有模块或提案新模块:' : ':'}`)
  for (const f of r.unowned.slice(0, 60)) lines.push(`  - ${f}`)
  if (r.unowned.length > 60) lines.push(`  ...等共 ${r.unowned.length} 个`)
  if (renames.length) {
    lines.push(`\n迁移线索 (${renames.length}),旧路径原属模块如下,照此更新锚点(update_anchors):`)
    for (const rn of renames.slice(0, 40)) {
      const owners = fileOwners(store.model, rn.from)
      lines.push(`  - ${rn.from}${owners.length ? `(原属 ${owners.join('、')})` : ''} → ${rn.to}`)
    }
    if (renames.length > 40) lines.push(`  ...等共 ${renames.length} 对`)
  }
  return lines.join('\n')
}

export function statusReport(store: Store): string {
  const last = lastSnapshot(store)
  let moduleCount = 0
  const featureCount = store.model.features.filter((f) => f.status === 'active').length
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

  const lines = [
    `快照: ${store.snapshots.length} 个${last ? `,最新 ${last.snapshot}(${last.date} ${last.title})` : ''}`,
    `模块: ${moduleCount} 个(active),功能: ${featureCount} 个(active)`,
  ]
  if (files) {
    const ignore = store.config.unowned_ignore.map((p) => picomatch(p, { dot: true }))
    const candidates = files.filter((f) => !ignore.some((m) => m(f)))
    const covered = candidates.filter((f) => anchorMatchers.some((m) => m(f)))
    const pct = candidates.length ? Math.round((covered.length / candidates.length) * 100) : 0
    lines.push(`锚点覆盖率: ${pct}% (${covered.length}/${candidates.length} 个文件,粗略口径)`)
  }
  if (brokenAnchors.length) {
    lines.push(`失效锚点 (${brokenAnchors.length}),下次快照必须处理:`)
    for (const a of brokenAnchors) lines.push(`  ✗ ${a}`)
  } else if (files) {
    lines.push('锚点全部有效')
  }
  return lines.join('\n')
}
