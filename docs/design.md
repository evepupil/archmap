# ArchMap 设计稿(v0.1)

> 工作名 archmap(架构地图),可再改。本文档本身遵守它提倡的写作规范:短句、人话、字数预算。

## 1. 要解决的问题

AI 编程的速度远超人的阅读速度,项目做到几十个 feat 之后,人会陷入三个困境:

1. **不知道项目现在长什么样**——整体架构只存在于 AI 的会话上下文里,会话一关就没了;
2. **不知道每个功能是怎么实现的**——AI 每次只汇报新增部分,旧功能全靠人脑记忆;
3. **不知道有没有偏离最初的要求**——代码 diff 太低层,人审不动,架构层的走样发现不了。

已有工具都不解决这个问题:git 给的是代码层时间线,抽象层级太低;AI 自由发挥写的文档是几万字黑话,没法读;C4/Structurizr 那类建模工具要人手工维护,没人坚持得下来。

**ArchMap 的定位:架构与功能层面的、AI 自动维护的、带时间线的项目地图。** 一句话:git 管代码的演化,archmap 管"项目能干什么、由哪几块组成"的演化。

## 2. 四条设计铁律

整个设计的成败押在这四条上,任何后续改动不得违反:

1. **补丁式演化,严禁整图重生成。** 地图是一个持久模型,AI 每次只能提交结构化补丁(增/改/废弃节点)。整图重生成会导致命名漂移、diff 全是噪音。
2. **可读性靠 schema 硬约束,严禁靠提示词。** 每个字段有字数上限,校验器打回超标内容。"请讲人话"四个字挡不住 AI 写一坨,字段长度限制可以。
3. **顶层永远一屏。** 顶层模块数 ≤9,膨胀只能发生在下钻层级。十年后顶层视图依然能看。
4. **地图锚定真实代码。** 每个模块节点声明它管辖哪些文件(锚点)。锚点让"AI 改了哪里、地图哪里该更新"变成可计算的问题,也让地图可以机械化体检、防止和代码脱节。

## 3. 三层地图模型

```
功能层(archmap)   微信扫码登录 / 订单导出 / ...          ← 用户视角,回答"能干什么"
      ↓ 挂载到
架构层(archmap)   认证模块 / 订单模块 / 通知模块 / ...     ← 模块视角,回答"由哪几块组成"
      ↓ 锚点(文件 glob / 符号)
代码层(codegraph)  文件 / 符号 / 调用关系                  ← 事实层,AST 自动推导
```

- **代码层**是推导物,codegraph 已解决,archmap 直接复用,自己一行解析代码的逻辑都不写。
- **架构层和功能层**是策展物,语义信息推导不出来,由 AI 提案补丁、校验器把关、随代码进 git。
- **层与层之间的锚点链接是全部价值所在**:向下,它让脏标记可计算;向上,它让人能从"功能"一路点到"文件"。

## 4. 存储布局

全部存在仓库内、跟代码一起提交(这一点与 codegraph 相反:codegraph 的索引是可重建的缓存所以 gitignore;archmap 的数据丢了就真丢了,必须进 git):

```
.archmap/
  config.yaml        # 预算、黑名单、读者设定(见 §7)
  model.yaml         # 当前地图。由工具从补丁流重放生成,人只读不手改
  snapshots/
    0001.yaml        # 每个快照一个文件:补丁 + 人话摘要 + commit 关联
    0002.yaml
    ...
```

`model.yaml` 永远等于把全部 snapshots 的补丁按序重放的结果。它是缓存性质的"当前视图",冲突时以补丁流为准,工具可随时重建。序列化由工具负责(固定排序、固定缩进),保证 git diff 干净。

## 5. 数据 Schema

### 5.1 model.yaml(当前地图)

```yaml
version: 1
modules:
  - id: auth                  # 稳定 id,创建后永不改,kebab-case
    name: 认证与账号           # ≤12 字
    summary: 登录、注册、会话保持,管所有"你是谁"的问题   # ≤40 字,人话
    anchors:                  # 管辖范围,文件 glob
      - src/auth/**
      - src/middleware/session.ts
    children: []              # 子模块,同结构;层深 ≤3,每层子节点 ≤9
    relations:
      - to: api-gateway
        kind: calls           # calls | depends | stores | notifies
        summary: 所有请求经它验明身份后才放行            # ≤30 字
    status: active            # active | deprecated
features:
  - id: feat-wechat-login
    name: 微信扫码登录         # ≤12 字
    summary: 用户用微信扫码即可登录,免注册               # ≤40 字
    modules: [auth]           # 至少挂一个模块
    anchors: []               # 可选,少数承重功能可锚到 文件#符号
    since: 12                 # 引入它的快照号,点击可跳到当时的 story
    status: active            # active | deprecated
```

### 5.2 快照文件(snapshots/NNNN.yaml)

```yaml
snapshot: 42
base: 41                      # 乐观锁:必须基于上一个快照的模型,否则校验失败
date: 2026-06-12
commits: [abc1234, def5678]   # 快照:commit = 1:N
kind: feature                 # feature | fix-confirm | refactor | audit
title: 支持微信扫码登录        # ≤20 字
story: |                      # 人话摘要,≤200 字。设定读者:三个月后忘光了的自己
  登录页加了微信扫码。扫码后微信回调我们的接口,自动建账号并发会话,
  老的密码登录保留。改动集中在认证模块,新增了一个回调路由。
patch:
  - op: add_feature
    feature: { id: feat-wechat-login, name: 微信扫码登录, ... }
  - op: update_module
    id: auth
    set: { summary: "登录、注册、扫码、会话保持,管所有\"你是谁\"的问题" }
dirty_checked: [auth, api-gateway]   # 本次脏检查覆盖的节点
no_change: [api-gateway]             # 其中确认"无架构影响"的节点
```

### 5.3 补丁操作类型(patch op)

| op | 说明 |
|---|---|
| `add_module` / `add_feature` | 新增节点 |
| `update_module` / `update_feature` | 改字段(id 不可改) |
| `move_module` | 改父子归属 |
| `update_anchors` | 调整管辖范围 |
| `add_relation` / `remove_relation` | 模块间关系 |
| `deprecate_module` / `deprecate_feature` | 废弃(**没有 delete**,历史必须可回放;查看器默认折叠废弃节点) |

### 5.4 校验规则(validator,机器执行,不过即打回)

- 字数:name ≤12、summary ≤40、relation.summary ≤30、title ≤20、story ≤200(config 可调);
- 结构:顶层模块 ≤9,每层子节点 ≤9,层深 ≤3;超预算时校验器要求先提交合并归类的补丁;
- 黑话:命中 config 黑名单词直接打回;
- 锚点:每个 glob 必须至少命中一个真实文件;
- 完整性:feature 至少挂一个 module;`base` 必须等于当前最新快照号;
- id:补丁不得修改已有 id,新 id 不得冲突。

## 6. 核心机制

### 6.1 脏标记传播(自动找出"地图哪里可能过期了")

```
git diff(commit 区间)
  → 变更文件清单
  → 与所有模块锚点求交 → 脏模块(含其祖先)
  → 挂在脏模块上的功能 → 脏功能
  → 剩下没命中任何锚点的文件 → 「无主文件」清单
```

AI 只需回答一个收敛的问题:"这些脏节点的描述还成立吗?要不要新增功能条目?"

**无主文件机制是地图保持全覆盖的关键**:出现无主文件时,AI 必须二选一——扩某个现有模块的锚点收编它,或提案新模块。这样地图对代码的覆盖率只增不减,新长出来的代码不会成为地图盲区。

### 6.2 快照工作流(嵌入现有开发流程)

```
feat 完成、门禁通过
  → archmap dirty          # 机械计算:脏节点 + 无主文件 + diff 概要
  → AI 提交 patch + story   # 只回答脏集合相关的问题,不重画全图
  → validator 校验          # 不过则打回重写,AI 自己改到过为止
  → 写入 snapshot,重放生成新 model.yaml
  → 随代码一起 commit(快照里记录 commit SHA 区间)
```

**空确认也是合法产出**:修 bug、小重构大多不动地图,此时提交 `kind: fix-confirm`、patch 为空、no_change 列出确认过的节点。这条记录让时间线保持诚实——"碰了认证模块,确认无架构影响"本身就是有价值的信息。多个小 commit 可以攒到下一次 feature 快照一并确认,不必每 commit 一张快照。

### 6.3 事前上下文注入(反向链路)

开工前,任务描述 → 命中相关功能/模块 → 顺锚点下钻拿到文件清单 → 连同节点的人话描述一起喂给 AI。AI 从第一行代码就知道自己在动哪个功能的哪块辖区。事后快照解决"你看不懂它",事前注入解决"它写跑偏",两个方向共用同一份数据。

### 6.4 锚点体检(防止地图说谎)

定期(或每次快照前)机械化检查:锚点 glob 还能命中文件吗?符号级锚点的符号还在吗(查 codegraph)?失效锚点列入下次快照必须处理的清单。另设 `kind: audit` 快照:开一个干净的 AI 会话,只给它地图 + 代码,逐节点核对描述与实现是否相符,产出差距补丁——写代码的会话自查不可靠,审计必须用无包袱的新会话。

## 7. config.yaml

```yaml
language: zh                 # story/summary 的语言
reader: 三个月后忘光了细节的项目作者     # 写作时的设定读者,注入提示词
budgets:                     # 字数与结构预算,§5.4 的数据来源
  module_summary: 40
  story: 200
  top_level_modules: 9
  max_depth: 3
banned_words: [赋能, 抓手, 闭环, 顶层设计, 架构升华]   # 黑话黑名单,可自定义
gate:                        # 哪些情况强制要求快照
  require_on: [feat]         # commit message 以 feat 开头,或 diff 命中锚点
```

## 8. MCP 工具面(阶段 2)

借 codegraph 的"按意图组织"原则,先小后大:

| 工具 | 意图 | 输入要点 |
|---|---|---|
| `archmap_context` | "开工前,这个任务相关的地图切片给我" | task 描述;返回相关功能/模块/锚点文件清单 |
| `archmap_dirty` | "这段 commit 动了地图的哪些辖区" | commit 区间;返回脏节点 + 无主文件 |
| `archmap_patch` | "提交快照补丁" | 结构化 patch + story;**schema 在协议层强制**,校验失败返回具体violation 让 AI 重试 |
| `archmap_diff` | "快照 A 到 B 之间架构变了什么" | 两个快照号 |
| `archmap_status` | "地图健康吗" | 锚点失效数、待确认脏节点、覆盖率 |

工程上直接照搬 codegraph 的:手写 JSON schema(不引 zod)、`MAX_INPUT_LENGTH/MAX_PATH_LENGTH` 输入校验、`validatePathWithinRoot` 防目录穿越、输出 15KB 硬上限、`ARCHMAP_MCP_TOOLS` 环境变量做工具白名单、server instructions 作为使用规范的单一真源(initialize 时下发,不往各工具的配置文件里塞重复文案)。

**与 codegraph 的一个刻意差异:不做 daemon。** codegraph 需要 daemon 是因为要常驻文件 watcher 和 SQLite;archmap 数据量小(纯 YAML)、无 watcher、读写都在工具调用瞬间完成,单进程 stdio 足够。不引入 SQLite,YAML 直读直写。

## 9. 查看器(人类的入口)

单文件静态 HTML(`archmap view` 起本地服务或直接打开),读 model + snapshots 渲染,无后端:

1. **全景图**:C4 风格分层方框图。顶层一屏,点击模块下钻;功能树按模块分组列在侧栏;
2. **时间线**:快照序列横轴。选中一个快照,图上高亮该次变化(新增绿/修改黄/废弃灰),旁边显示 story;选中两个快照,显示区间累计 diff;
3. **回放**:拖动时间轴看项目从第一个快照长到现在——给新人 onboarding 和找回记忆用,数据天然就有,成本接近零;
4. **下钻到代码**:节点详情页列出锚点文件、关联功能、引入快照,锚点可点击跳转编辑器(`vscode://` 链接)。

## 10. 与 AI 编程工具的集成

照搬 codegraph 的 installer 经验:

- **marker 幂等安装**:往 CLAUDE.md 等文件写使用规范时用 `<!-- ARCHMAP_START/END -->` 标记块,重复安装字节不变,卸载干净剥离;
- **git hook(可选)**:post-commit 后台检查"diff 命中锚点但没有新快照"则提示,绝不阻塞 git,脚本前判 `command -v archmap`;
- **target 插件化**:每个 AI 工具(Claude Code/Cursor/...)一个 target 对象实现 detect/install/uninstall,新工具支持只加一个文件。

## 11. 从 codegraph 借鉴清单(调研结论摘要)

| 借什么 | 出处 | 用在哪 |
|---|---|---|
| 按意图组织的工具描述 + 反模式清单 | server-instructions.ts | archmap 的 server instructions |
| 输入校验三件套(长度/路径/越界) | tools.ts, utils.ts | 所有 MCP 工具入参 |
| 输出预算分档(按项目规模) | getExploreOutputBudget | archmap_context 的切片大小 |
| 工具白名单环境变量 | CODEGRAPH_MCP_TOOLS | ARCHMAP_MCP_TOOLS |
| marker 幂等安装/卸载 | git-hooks.ts, installer | 规范注入 + git hook |
| target 插件化(一个 agent 一个文件) | installer/targets | 多工具安装器 |
| staleness 提示(非阻塞 banner) | withStalenessNotice | 有脏节点未确认时,context 结果前置提醒 |
| pending 积累 + 一次性处理 | sync/watcher.ts | 多 commit 攒一个快照的语义 |
| **不借**:daemon/proxy、SQLite、tree-sitter | — | archmap 无常驻需求,YAML 足够 |

## 12. MVP 路线

**阶段 0(1~2 天,验证假设)**:定 schema + 写校验器 CLI(单脚本)+ 一个 skill(`/archmap-snapshot`:跑 dirty 计算、引导 AI 提补丁、跑校验、写文件)。在一个真实项目上跑 10 个 feat,**验收标准只有一条:产出的 story 和地图,你本人愿意读、读得懂**。这条不过,后面全免谈。

**阶段 1(查看器)**:单文件 HTML,先做全景图 + 时间线高亮,回放和双快照 diff 其次。

**阶段 2(MCP 化)**:五个工具 + schema 层强制 + installer。skill 降级为薄壳。

**阶段 3(codegraph 联动)**:锚点体检查符号、脏标记精确到符号级、archmap_context 组合 codegraph_context 一次给齐"语义切片 + 代码切片"。

## 13. 风险与对策

| 风险 | 对策 |
|---|---|
| AI 产出又是一坨黑话 | schema 字段化 + 字数硬上限 + 黑名单,校验器打回,不靠自觉 |
| 命名/分组随时间漂移 | 补丁式演化 + id 不可变 + 只能 deprecate 不能 delete |
| 地图与代码渐行渐远 | 锚点体检 + 无主文件强制收编 + audit 快照(新会话审计) |
| 流程太重,小改动也要走快照 | fix-confirm 空确认 + 多 commit 攒一个快照 + gate 只对 feat 强制 |
| 图无限膨胀看不动 | 顶层一屏铁律 + 每层节点预算 + 超额强制合并 + 废弃节点折叠 |
| 模型文件合并冲突(多人/多分支) | 补丁流是 append-only 文件,天然少冲突;model.yaml 冲突时丢弃重放即可 |

## 14. 已决策与待定

已决策(2026-06-12):

- **gate 默认只提醒,不阻塞**:`archmap check` 永远 exit 0;
- **暂不加"验收标准"字段**,不与 ROADMAP 需求对账打通(留作未来阶段);
- YAML 落定为存储格式,实现中回写无障碍。

仍待定:

1. 工具名:archmap 只是工作名;
2. 阶段 1 查看器的具体形态(单文件 HTML 的渲染方案)。
