import picomatch from 'picomatch'
import type { DirtyResult, Model, ModuleNode } from './types.js'
import { toPosix } from './util.js'

interface CompiledModule {
  id: string
  ancestors: string[]
  match: (f: string) => boolean
}

function compileModules(model: Model): CompiledModule[] {
  const out: CompiledModule[] = []
  const visit = (nodes: ModuleNode[], ancestors: string[], ancestorDeprecated: boolean) => {
    for (const n of nodes) {
      const deprecated = ancestorDeprecated || n.status === 'deprecated'
      if (!deprecated && n.anchors.length > 0) {
        const matchers = n.anchors.map((a) => picomatch(toPosix(a), { dot: true }))
        out.push({ id: n.id, ancestors, match: (f) => matchers.some((m) => m(f)) })
      }
      visit(n.children, [...ancestors, n.id], deprecated)
    }
  }
  visit(model.modules, [], false)
  return out
}

/**
 * 脏标记传播:变更文件 → 脏模块(含祖先)→ 脏功能;
 * 没有命中任何模块锚点的文件进无主清单。
 */
export function computeDirty(
  model: Model,
  changedFiles: string[],
  ignorePatterns: string[] = [],
): DirtyResult {
  const ignore = ignorePatterns.map((p) => picomatch(p, { dot: true }))
  const files = changedFiles.map(toPosix).filter((f) => !ignore.some((m) => m(f)))

  const compiled = compileModules(model)
  const dirtyModules = new Set<string>()
  const unowned: string[] = []

  for (const file of files) {
    let owned = false
    for (const cm of compiled) {
      if (cm.match(file)) {
        owned = true
        dirtyModules.add(cm.id)
        for (const a of cm.ancestors) dirtyModules.add(a)
      }
    }
    if (!owned) unowned.push(file)
  }

  const dirtyFeatures = new Set<string>()
  for (const f of model.features) {
    if (f.status === 'deprecated') continue
    if (f.modules.some((m) => dirtyModules.has(m))) {
      dirtyFeatures.add(f.id)
      continue
    }
    for (const anchor of f.anchors) {
      const isMatch = picomatch(toPosix(anchor.split('#')[0]), { dot: true })
      if (files.some((file) => isMatch(file))) {
        dirtyFeatures.add(f.id)
        break
      }
    }
  }

  return {
    changed: files,
    dirtyModules: [...dirtyModules].sort(),
    dirtyFeatures: [...dirtyFeatures].sort(),
    unowned: unowned.sort(),
  }
}
