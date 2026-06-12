# ArchMap

架构与功能层面的、AI 自动维护的、带时间线的项目地图。

git 管代码的演化;archmap 管"项目能干什么、由哪几块组成"的演化。AI 每完成一个 feat,提交一个对地图的**补丁** + 一段**人话摘要**,形成与 commit 关联(1:N)的线性架构快照。可读性靠 schema 硬约束(字数预算、结构预算、黑话黑名单),校验器打回,不靠 AI 自觉。

完整设计见 [docs/design.md](docs/design.md)。

## 安装与使用

```bash
npm install && npm run build
npm link            # 把 archmap 命令放进 PATH(或直接 node dist/cli.js)

cd 你的项目
archmap init        # 创建 .archmap/ 并安装 /archmap-snapshot skill
```

之后在 AI 编程工具里,每完成一个 feat 执行 `/archmap-snapshot`,AI 会按 skill 流程算脏集、提补丁、过校验、落快照。

## 命令

| 命令 | 作用 |
|---|---|
| `archmap init [path]` | 初始化 `.archmap/`,安装 skill(快照 + 审计)、post-commit 提醒钩子;检测到 Codex 同步投放 |
| `archmap hook [--remove]` | 单独安装/移除 post-commit 提醒钩子 |
| `archmap dirty [--range a..b] [--json]` | 算脏模块/脏功能/无主文件(默认自上个快照到工作区) |
| `archmap validate <draft.yaml>` | 只校验草稿 |
| `archmap apply <draft.yaml> [--keep]` | 校验并落盘快照,重放更新 model.yaml |
| `archmap view [--port n] [--out file]` | 打开架构舆图;默认实时服务(快照更新页面自动刷新),`--out` 导出静态 HTML |
| `archmap replay [--check]` | 从补丁流重建 model.yaml |
| `archmap timeline` | 列出全部快照 |
| `archmap status` | 快照数、锚点健康、覆盖率 |
| `archmap check` | gate 检查,只提醒不阻塞 |

## 数据布局(均随代码进 git)

```
.archmap/
  config.yaml      # 预算、黑名单、读者设定
  model.yaml       # 当前地图(补丁流重放的缓存,人只读不手改)
  snapshots/       # 每快照一个文件:补丁 + 人话摘要 + commit 关联
```

## 开发

```bash
npm run check      # typecheck + 测试(门禁)
npm run test:watch
```
