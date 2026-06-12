export const SERVER_INSTRUCTIONS = `# archmap — 项目的架构/功能地图(语义层;与代码层工具 codegraph 互补)

地图记录"项目能干什么(功能)、由哪几块组成(模块)、每块管哪些文件(锚点)",随快照演化,数据在仓库 .archmap/ 下。

## 按意图选工具

- 接到开发/修改任务,想知道动哪里 → \`archmap_context\`(传任务描述,返回相关功能/模块/辖区文件/最近变动;先看切片再读代码)
- 完成一个 feat、门禁已过,要记架构快照 → 先 \`archmap_dirty\` 拿脏集和无主文件,再 \`archmap_patch\` 提交补丁 + 人话摘要
- 想知道两个快照之间架构净变化 → \`archmap_diff\`
- 地图健康度(锚点失效/覆盖率/最新快照) → \`archmap_status\`

## 反模式

- 不要为了解项目结构通读源码 —— 先 archmap_context,再精读命中文件
- 不要手改 .archmap/ 下的文件 —— model.yaml 可以 Read,写入必须走 archmap_patch
- archmap_patch 校验失败时不要放弃记录 —— 按 violation 提示修正后重试,直到通过
- 不要重画整图 —— 每次只提交与本次改动相关的最小补丁

## 写作硬约束(校验器强制)

设定读者是"三个月后忘光细节的项目作者"。字数预算:name≤12、summary≤40、title≤20、story≤200(不计空白);id 用 kebab-case 且创建后不可改;无主文件必须收编或提案新模块;无架构变化用 kind=fix-confirm + 空 patch 留痕。`
