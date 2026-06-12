export type RelationKind = 'calls' | 'depends' | 'stores' | 'notifies'

export interface Relation {
  to: string
  kind: RelationKind
  summary: string
}

export type NodeStatus = 'active' | 'deprecated'

export interface ModuleNode {
  id: string
  name: string
  summary: string
  anchors: string[]
  children: ModuleNode[]
  relations: Relation[]
  status: NodeStatus
}

export interface Feature {
  id: string
  name: string
  summary: string
  modules: string[]
  anchors: string[]
  since: number
  status: NodeStatus
}

export interface Model {
  version: 1
  modules: ModuleNode[]
  features: Feature[]
}

/** AI 在补丁里提交的新模块,children/status 由工具管理 */
export interface NewModule {
  id: string
  name: string
  summary: string
  anchors?: string[]
  relations?: Relation[]
}

export interface NewFeature {
  id: string
  name: string
  summary: string
  modules: string[]
  anchors?: string[]
}

export type PatchOp =
  | { op: 'add_module'; parent?: string | null; module: NewModule }
  | { op: 'update_module'; id: string; set: Partial<Pick<ModuleNode, 'name' | 'summary'>> }
  | { op: 'move_module'; id: string; parent: string | null }
  | { op: 'update_anchors'; target: string; anchors: string[] }
  | { op: 'add_relation'; from: string; relation: Relation }
  | { op: 'remove_relation'; from: string; to: string; kind?: RelationKind }
  | { op: 'deprecate_module'; id: string }
  | { op: 'add_feature'; feature: NewFeature }
  | { op: 'update_feature'; id: string; set: Partial<Pick<Feature, 'name' | 'summary' | 'modules'>> }
  | { op: 'deprecate_feature'; id: string }

export type SnapshotKind = 'init' | 'feature' | 'fix-confirm' | 'refactor' | 'audit'

export interface Snapshot {
  snapshot: number
  base: number
  date: string
  commits: string[]
  kind: SnapshotKind
  title: string
  story: string
  patch: PatchOp[]
  dirty_checked: string[]
  no_change: string[]
}

/** AI 提交的快照草稿,编号/base/日期由工具补全 */
export interface SnapshotDraft {
  kind: SnapshotKind
  title: string
  story: string
  patch: PatchOp[]
  commits?: string[]
  dirty_checked?: string[]
  no_change?: string[]
}

export interface Budgets {
  name: number
  module_summary: number
  feature_summary: number
  relation_summary: number
  title: number
  story: number
  top_level_modules: number
  children_per_level: number
  max_depth: number
}

export interface ArchmapConfig {
  language: string
  reader: string
  budgets: Budgets
  banned_words: string[]
  unowned_ignore: string[]
  gate: { require_on: string[] }
}

export interface Violation {
  path: string
  message: string
}

export interface DirtyResult {
  changed: string[]
  dirtyModules: string[]
  dirtyFeatures: string[]
  unowned: string[]
}
