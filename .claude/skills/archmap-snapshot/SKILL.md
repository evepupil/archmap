---
name: archmap-snapshot
description: 完成一个 feat 或一组改动后,更新项目架构地图(.archmap/)并记录架构快照。Use when 用户要求记录/更新架构快照,或一个功能开发完成、门禁通过之后。
---

# 记录架构快照

archmap 维护一张"架构 + 功能"两层地图(`.archmap/model.yaml`),每次快照是对地图的一个**补丁**。你的任务:看清这次改动碰了地图哪里,提交最小补丁和一段人话摘要。

## 流程

1. **算脏集**:运行 `archmap dirty`。输出三部分:
   - 脏模块/脏功能:这次代码改动落在它们辖区里,逐个判断描述是否还成立;
   - 无主文件:没有任何模块认领的变更文件,**必须处理**(见下);
   - 变更文件清单:供你参考。
2. **读地图**:打开 `.archmap/model.yaml`,只看脏节点和它们的邻居,不必通读。
3. **写草稿**:写 `.archmap/draft.yaml`(格式见下)。
4. **提交**:运行 `archmap apply .archmap/draft.yaml`。校验失败会列出每条违规,按提示修改草稿后重试,直到通过。通过后删除草稿文件。
5. **入库**:把 `.archmap/` 的变更与代码一起 commit(或紧跟一个 `docs: 架构快照 NNNN` commit)。

## 草稿格式

```yaml
kind: feature        # feature | fix-confirm | refactor | audit | init
title: 支持微信扫码登录            # ≤20 字
story: |                          # ≤200 字(不计空白)
  登录页加了微信扫码。扫码后微信回调我们的接口,自动建账号并发会话,
  老的密码登录保留。改动集中在认证模块,新增了一个回调路由。
patch:
  - op: add_feature
    feature:
      id: feat-wechat-login
      name: 微信扫码登录
      summary: 用户用微信扫码即可登录,免注册
      modules: [auth]
dirty_checked: [auth, api-gateway]   # 本次检查过的脏节点
no_change: [api-gateway]             # 其中确认无架构影响的
```

`snapshot`/`base`/`date`/`commits` 不用写,工具自动补全。

## 补丁操作一览

| op | 参数 |
|---|---|
| `add_module` | `parent`(可空=顶层), `module: {id,name,summary,anchors,relations}` |
| `update_module` | `id`, `set: {name?, summary?}` |
| `move_module` | `id`, `parent`(null=顶层) |
| `update_anchors` | `target`(模块或功能 id), `anchors: [...]` |
| `add_relation` | `from`, `relation: {to, kind, summary}`;kind ∈ calls/depends/stores/notifies |
| `remove_relation` | `from`, `to`, `kind?` |
| `deprecate_module` / `deprecate_feature` | `id`(没有 delete,只能废弃) |
| `add_feature` | `feature: {id,name,summary,modules,anchors?}` |
| `update_feature` | `id`, `set: {name?, summary?, modules?}` |

## 写作规范(校验器强制,写之前先看)

- 设定读者:**三个月后忘光了细节的项目作者**。写给人看,讲清"它是干什么的",别写实现术语堆砌。
- 字数预算:name ≤12、summary ≤40、relation.summary ≤30、title ≤20、story ≤200。超了直接打回。
- id 一律 kebab-case,创建后永不修改;功能 id 建议 `feat-` 前缀。
- 顶层模块 ≤9、每层子模块 ≤9、层深 ≤3。超预算时先提交合并归类的补丁。

## 规则

- **无主文件必须二选一**:扩某个现有模块的 `update_anchors` 收编它,或 `add_module` 提案新模块。地图对代码的覆盖只增不减。
- **空补丁合法**:修 bug、小重构不动地图时,用 `kind: fix-confirm`、`patch: []`,把检查过的脏节点写进 `dirty_checked`、确认无影响的写进 `no_change`。这条记录让时间线保持诚实。
- **多个小 commit 可以攒到下一次 feature 快照一并确认**,不必每个 commit 一张快照。
- **只提最小补丁**:严禁重写整图、严禁顺手"优化"没被这次改动碰到的节点描述。

## 首次建图(model.yaml 还是空的)

1. `archmap dirty` 会把全部文件列为无主;
2. 通读项目结构(可用 codegraph),提案 ≤9 个顶层模块,每个配锚点,必要时加一层子模块;
3. 草稿用 `kind: init`,title 如"首次建图",story 用一段话概括这个项目是干什么的;
4. 已有的主要功能用 `add_feature` 一并补上(只补大的,细碎的以后随快照演化)。
