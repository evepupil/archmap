import { allIds, emptyModel, findFeature, findModule, walkModules } from './model.js'
import type { Model, ModuleNode, PatchOp, Snapshot } from './types.js'
import { ArchmapError } from './util.js'

export class PatchError extends ArchmapError {}

function deepClone<T>(v: T): T {
  return structuredClone(v)
}

function detachModule(model: Model, id: string): ModuleNode {
  const found = findModule(model, id)
  if (!found) throw new PatchError(`模块不存在: ${id}`)
  const list = found.parent ? found.parent.children : model.modules
  const idx = list.findIndex((m) => m.id === id)
  list.splice(idx, 1)
  return found.node
}

function isDescendant(root: ModuleNode, id: string): boolean {
  for (const c of root.children) {
    if (c.id === id || isDescendant(c, id)) return true
  }
  return false
}

/**
 * 对模型应用单个补丁操作(原地修改)。
 * 返回本次操作"触碰"的节点 id,供校验器只检查增量。
 */
export function applyOp(model: Model, op: PatchOp, snapshotNum: number): string[] {
  switch (op.op) {
    case 'add_module': {
      if (allIds(model).has(op.module.id)) throw new PatchError(`id 已存在: ${op.module.id}`)
      const node: ModuleNode = {
        id: op.module.id,
        name: op.module.name,
        summary: op.module.summary,
        anchors: op.module.anchors ?? [],
        children: [],
        relations: op.module.relations ?? [],
        status: 'active',
      }
      if (op.parent == null) {
        model.modules.push(node)
      } else {
        const parent = findModule(model, op.parent)
        if (!parent) throw new PatchError(`父模块不存在: ${op.parent}`)
        parent.node.children.push(node)
      }
      return [node.id]
    }
    case 'update_module': {
      const found = findModule(model, op.id)
      if (!found) throw new PatchError(`模块不存在: ${op.id}`)
      if ('id' in op.set) throw new PatchError(`id 不可修改: ${op.id}`)
      if (op.set.name !== undefined) found.node.name = op.set.name
      if (op.set.summary !== undefined) found.node.summary = op.set.summary
      return [op.id]
    }
    case 'move_module': {
      if (op.parent === op.id) throw new PatchError(`不能把模块移到自己之下: ${op.id}`)
      const probe = findModule(model, op.id)
      if (!probe) throw new PatchError(`模块不存在: ${op.id}`)
      if (op.parent != null && isDescendant(probe.node, op.parent))
        throw new PatchError(`不能把模块移到自己的子孙之下: ${op.id} -> ${op.parent}`)
      const node = detachModule(model, op.id)
      if (op.parent == null) {
        model.modules.push(node)
      } else {
        const parent = findModule(model, op.parent)
        if (!parent) throw new PatchError(`父模块不存在: ${op.parent}`)
        parent.node.children.push(node)
      }
      return [op.id]
    }
    case 'update_anchors': {
      const mod = findModule(model, op.target)
      if (mod) {
        mod.node.anchors = op.anchors
        return [op.target]
      }
      const feat = findFeature(model, op.target)
      if (feat) {
        feat.anchors = op.anchors
        return [op.target]
      }
      throw new PatchError(`节点不存在: ${op.target}`)
    }
    case 'add_relation': {
      const from = findModule(model, op.from)
      if (!from) throw new PatchError(`模块不存在: ${op.from}`)
      if (!findModule(model, op.relation.to)) throw new PatchError(`目标模块不存在: ${op.relation.to}`)
      if (from.node.relations.some((r) => r.to === op.relation.to && r.kind === op.relation.kind))
        throw new PatchError(`关系已存在: ${op.from} -${op.relation.kind}-> ${op.relation.to}`)
      from.node.relations.push(op.relation)
      return [op.from]
    }
    case 'remove_relation': {
      const from = findModule(model, op.from)
      if (!from) throw new PatchError(`模块不存在: ${op.from}`)
      const before = from.node.relations.length
      from.node.relations = from.node.relations.filter(
        (r) => !(r.to === op.to && (op.kind === undefined || r.kind === op.kind)),
      )
      if (from.node.relations.length === before)
        throw new PatchError(`要移除的关系不存在: ${op.from} -> ${op.to}`)
      return [op.from]
    }
    case 'deprecate_module': {
      const found = findModule(model, op.id)
      if (!found) throw new PatchError(`模块不存在: ${op.id}`)
      found.node.status = 'deprecated'
      return [op.id]
    }
    case 'add_feature': {
      if (allIds(model).has(op.feature.id)) throw new PatchError(`id 已存在: ${op.feature.id}`)
      if (op.feature.modules.length === 0)
        throw new PatchError(`功能至少要挂一个模块: ${op.feature.id}`)
      for (const m of op.feature.modules) {
        if (!findModule(model, m)) throw new PatchError(`功能挂载的模块不存在: ${m}`)
      }
      model.features.push({
        id: op.feature.id,
        name: op.feature.name,
        summary: op.feature.summary,
        modules: op.feature.modules,
        anchors: op.feature.anchors ?? [],
        since: snapshotNum,
        status: 'active',
      })
      return [op.feature.id]
    }
    case 'update_feature': {
      const feat = findFeature(model, op.id)
      if (!feat) throw new PatchError(`功能不存在: ${op.id}`)
      if ('id' in op.set) throw new PatchError(`id 不可修改: ${op.id}`)
      if (op.set.name !== undefined) feat.name = op.set.name
      if (op.set.summary !== undefined) feat.summary = op.set.summary
      if (op.set.modules !== undefined) {
        if (op.set.modules.length === 0) throw new PatchError(`功能至少要挂一个模块: ${op.id}`)
        for (const m of op.set.modules) {
          if (!findModule(model, m)) throw new PatchError(`功能挂载的模块不存在: ${m}`)
        }
        feat.modules = op.set.modules
      }
      return [op.id]
    }
    case 'deprecate_feature': {
      const feat = findFeature(model, op.id)
      if (!feat) throw new PatchError(`功能不存在: ${op.id}`)
      feat.status = 'deprecated'
      return [op.id]
    }
    default: {
      const never: never = op
      throw new PatchError(`未知操作: ${JSON.stringify(never)}`)
    }
  }
}

/** 应用整个补丁,返回新模型与触碰过的节点 id */
export function applyPatch(
  model: Model,
  patch: PatchOp[],
  snapshotNum: number,
): { model: Model; touched: string[] } {
  const next = deepClone(model)
  const touched: string[] = []
  for (const op of patch) {
    touched.push(...applyOp(next, op, snapshotNum))
  }
  return { model: next, touched: [...new Set(touched)] }
}

/** 从补丁流重放出当前模型。model.yaml 只是它的缓存。 */
export function replay(snapshots: Snapshot[]): Model {
  let model = emptyModel()
  const sorted = [...snapshots].sort((a, b) => a.snapshot - b.snapshot)
  for (const snap of sorted) {
    model = applyPatch(model, snap.patch, snap.snapshot).model
  }
  return model
}

/** 收集模型里出现过的全部模块 id(供 dirty_checked 等引用检查) */
export function moduleIds(model: Model): Set<string> {
  const ids = new Set<string>()
  walkModules(model, (n) => ids.add(n.id))
  return ids
}
