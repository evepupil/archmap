# ArchMap 项目规范

## 这是什么

架构/功能层面的项目地图工具:AI 每完成一个 feat,对持久地图(.archmap/model.yaml)提交补丁 + 人话摘要,形成与 commit 关联的线性架构快照。设计文档在 docs/design.md,**四条铁律(§2)是设计底线,任何改动不得违反**:补丁式演化、schema 硬约束、顶层一屏、锚点锚定真实代码。

## 技术栈与结构

- TypeScript + ESM(NodeNext,源码 import 需带 .js 后缀),Node ≥20
- 依赖刻意精简:commander / picomatch / yaml,无 SQLite、无 daemon、MCP 不用 SDK(与 codegraph 的差异是有意的,见 design.md §8)
- `src/` 按职责分层,依赖方向只允许向下:
  - `core/` 领域核心:types / util / config / model(序列化)/ patch(补丁与重放)/ validate(校验)——不依赖其他层
  - `store/` 持久化:snapshot(存储与落盘)/ git
  - `analysis/` 派生计算:dirty(脏标记)/ diff(变化归类与区间聚合)/ context(任务→地图切片)/ reports(共享报告文本)
  - `viewer/` 查看器:view(数据预计算与模板注入)/ serve(实时 SSE 服务)
  - `setup/` 安装面:init / hooks(post-commit 提醒)
  - `mcp/` MCP 服务器:engine(JSON-RPC)/ tools(五工具)/ instructions(单一真源)
  - `cli.ts` 入口,组装以上各层
- `templates/` 下是 AI 工作流 skill 与查看器模板,`archmap init` / `archmap view` 时按相对路径读取(`../../templates`,移动文件注意层级)

## 门禁

```bash
npm run check   # tsc --noEmit + vitest run,提交前必须全过
```

## 约定

- 模型唯一真源是补丁流(snapshots/),model.yaml 永远是重放结果的缓存;任何新功能不得绕过 replay 直接改 model.yaml
- 序列化键序由 model.ts 的 canon* 函数独占,保证 git diff 干净
- CLI 与校验器的用户文案用中文,简短、可执行(告诉用户下一步做什么)
- 测试只覆盖业务逻辑(patch/validate/dirty/snapshot),CLI 打印格式不写测试
