import { stringify } from 'yaml'
import type { Feature, Model, ModuleNode } from './types.js'

export function emptyModel(): Model {
  return { version: 1, modules: [], features: [] }
}

export interface FoundModule {
  node: ModuleNode
  parent: ModuleNode | null
  depth: number
}

/** 深度优先遍历全部模块(含 deprecated) */
export function walkModules(
  model: Model,
  cb: (node: ModuleNode, parent: ModuleNode | null, depth: number) => void,
): void {
  const visit = (nodes: ModuleNode[], parent: ModuleNode | null, depth: number) => {
    for (const n of nodes) {
      cb(n, parent, depth)
      visit(n.children, n, depth + 1)
    }
  }
  visit(model.modules, null, 1)
}

export function findModule(model: Model, id: string): FoundModule | null {
  let found: FoundModule | null = null
  walkModules(model, (node, parent, depth) => {
    if (node.id === id && !found) found = { node, parent, depth }
  })
  return found
}

export function findFeature(model: Model, id: string): Feature | null {
  return model.features.find((f) => f.id === id) ?? null
}

export function allIds(model: Model): Set<string> {
  const ids = new Set<string>()
  walkModules(model, (n) => ids.add(n.id))
  for (const f of model.features) ids.add(f.id)
  return ids
}

/** 模块是否生效:自身与所有祖先都未废弃 */
export function isModuleActive(model: Model, id: string): boolean {
  let active = false
  const visit = (nodes: ModuleNode[], ancestorDeprecated: boolean) => {
    for (const n of nodes) {
      const deprecated = ancestorDeprecated || n.status === 'deprecated'
      if (n.id === id) active = !deprecated
      visit(n.children, deprecated)
    }
  }
  visit(model.modules, false)
  return active
}

// 序列化由工具独占:固定键序、固定缩进,保证 git diff 干净
function canonModule(m: ModuleNode): Record<string, unknown> {
  return {
    id: m.id,
    name: m.name,
    summary: m.summary,
    anchors: m.anchors,
    children: m.children.map(canonModule),
    relations: m.relations.map((r) => ({ to: r.to, kind: r.kind, summary: r.summary })),
    status: m.status,
  }
}

function canonFeature(f: Feature): Record<string, unknown> {
  return {
    id: f.id,
    name: f.name,
    summary: f.summary,
    modules: f.modules,
    anchors: f.anchors,
    since: f.since,
    status: f.status,
  }
}

export function serializeModel(model: Model): string {
  return stringify(
    {
      version: model.version,
      modules: model.modules.map(canonModule),
      features: model.features.map(canonFeature),
    },
    { indent: 2, lineWidth: 0 },
  )
}
