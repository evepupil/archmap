# ArchMap 项目规范

## 这是什么

架构/功能层面的项目地图工具:AI 每完成一个 feat,对持久地图(.archmap/model.yaml)提交补丁 + 人话摘要,形成与 commit 关联的线性架构快照。设计文档在 docs/design.md,**四条铁律(§2)是设计底线,任何改动不得违反**:补丁式演化、schema 硬约束、顶层一屏、锚点锚定真实代码。

## 技术栈与结构

- TypeScript + ESM(NodeNext,源码 import 需带 .js 后缀),Node ≥20
- 依赖刻意精简:commander / picomatch / yaml,无 SQLite、无 daemon(与 codegraph 的差异是有意的,见 design.md §8)
- `src/` 一个文件一个职责:types / config / model(序列化)/ patch(补丁与重放)/ validate(校验)/ dirty(脏标记)/ git / snapshot(存储与落盘)/ init / cli
- `templates/SKILL.md` 是 AI 用的工作流说明,`archmap init` 时复制进目标项目

## 门禁

```bash
npm run check   # tsc --noEmit + vitest run,提交前必须全过
```

## 约定

- 模型唯一真源是补丁流(snapshots/),model.yaml 永远是重放结果的缓存;任何新功能不得绕过 replay 直接改 model.yaml
- 序列化键序由 model.ts 的 canon* 函数独占,保证 git diff 干净
- CLI 与校验器的用户文案用中文,简短、可执行(告诉用户下一步做什么)
- 测试只覆盖业务逻辑(patch/validate/dirty/snapshot),CLI 打印格式不写测试
