# MusicFree Fork Handoff

更新时间：2026-10-16
当前状态：R1/R2、R3、R4、R5、R6、R7、R8 已验收通过；R9 代码实现与静态验证完成，待 Android 真机验收；最终 Android 回归与 R9 验收合并执行。

## 1. 分支

R7 已验收分支：

```text
feat/0.6.2-playback-source-adaptive
```

R7 已提交：

```text
02f25c0 feat: enhance playback source continuity
59a0c39 fix: clarify batch source selection
57db54d fix: reuse resolved temporary sources
```

R8 已验收分支：

```text
feat/0.6.2-plugin-source-groups
```

R8 已提交：

```text
432d9f9 feat(plugin): add source groups
a91d236 fix(plugin): clarify group operation risk
d58e0ed fix(plugin): stabilize source groups
a68696d chore: normalize text line endings
```

R9 当前开发分支：

```text
feat/0.6.2-plugin-availability-test
```

## 2. R7 收尾结论

已交付：

1. 换源成功后播放页显示临时来源插件名；不修改原始歌曲身份。
2. 记录 `歌单 ID + 原始 platform -> 成功插件` 的歌单内自动偏好。
3. 歌单页提供批量临时换源入口；自动推荐默认选中，标题展示预计影响数量，支持串行执行和后台运行。
4. 批量任务遵守 15 秒单首预算；候选停止条件改为候选耗尽、预算到期或切歌，取消 5 个上限。
5. 连续空结果只做内存态候选抑制；不标记 `userInvalid`，非空结果或下次启动恢复。
6. 播放优先复用已解析的临时来源；失败后继续候选流程。
7. 批量结果弹窗支持后台运行，完成后通过 toast 汇总。

关键实现与修复：

- `src/core/playbackSource.ts`：歌单偏好、临时来源 atom、空结果抑制。
- `src/core/mediaSourceResolver.ts`：候选选择、预算、严格匹配、候选抑制。
- `src/core/mediaSourceBatch.ts`：批量筛选与串行解析。
- `src/core/trackPlayer/index.ts`：优先复用临时解析结果并继续失败兜底。
- `src/pages/musicDetail/components/navBar.tsx`：临时来源展示。
- `src/pages/sheetDetail/components/navBar.tsx`：批量换源入口。
- `src/components/dialogs/components/batchSourceDialog.tsx`：结果展示与后台运行。

## 3. R8 收尾结论

已交付：

1. 插件来源记录区分订阅、本地、网络和内置；本地 / 网络是逻辑组，不写入 `plugin.subscribeUrl`。
2. 插件管理页展示来源分组、类型、数量和最近变更时间。
3. 来源组详情支持整组启用 / 禁用、归档 / 恢复；批量操作应用既有插件状态，单个状态仍可独立调整。
4. 卸载、替换和更新同步维护来源；更新保留原分组。
5. 来源关系存于独立 `plugin.origin`，不进入备份 / 恢复。

R8 真机反馈修复：

1. 新增订阅立即展示并自动拉取；失败时保留空订阅组。
2. 依据 R5 历史订阅记录修正首次启动分组兜底。
3. 概览健康统计响应式刷新。
4. 概览数量从健康“可用”改为“已取消勾选”。

关键实现：

- `src/core/pluginManager/pluginOrigin.ts`：来源分组模型、原子读取和分组构建。
- `src/core/pluginManager/index.ts`：安装、更新、卸载来源记录。
- `src/pages/setting/settingTypes/pluginSetting/views/pluginList.tsx`：来源分组入口和概览统计。
- `src/pages/setting/settingTypes/pluginSetting/views/pluginOriginDetail.tsx`：分组详情与组级操作。

## 4. R9 代码阶段记录（待真机验收）

已确认 R9-Q1 到 Q9 执行口径，详见 `docs/fork-requirements.md` 第 20 章。

已实现：

1. “批量测试插件”入口放在“已安装插件”标题下方；进入批量模式后，勾选数量和测试 / 取消 / 完成操作显示在同一入口下方。
2. 测试前可输入搜索关键词，为空时使用“音乐”。
3. 串行探测搜索和取源；搜索非空或取源返回有效 URL 即通过。
4. 单请求 5 秒超时，单插件总上限 10 秒；双失败一次测试即写入既有 `quarantined`。
5. 批量入口下方展示等待 / 测试中 / 通过 / 失败 / 跳过汇总，插件项继续展示逐插件状态。
6. 明确勾选的所有插件都参与测试；禁用开关和手动状态不被自动改写，测试成功只恢复 `quarantined`。
7. 测试明细和汇总只保留会话态；取消在当前请求 / 阶段边界生效。
8. 不为每个插件增加常驻测试按钮；单个插件也可通过选择模式测试。

关键实现：

- `src/core/pluginAvailability.ts`：探测状态、串行测试和超时判定。
- `src/core/pluginManager/health.ts`：双失败直接进入 `quarantined`。
- `src/pages/setting/settingTypes/pluginSetting/views/pluginList.tsx`：勾选、测试入口、取消和汇总。
- `src/pages/setting/settingTypes/pluginSetting/components/pluginItem.tsx`：勾选框与测试状态标签。

静态验证：

```powershell
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/eslint/bin/eslint.js src/core/pluginAvailability.ts src/core/pluginManager/health.ts src/pages/setting/settingTypes/pluginSetting/components/pluginItem.tsx src/pages/setting/settingTypes/pluginSetting/views/pluginList.tsx
node node_modules/jest/bin/jest.js --passWithNoTests
git diff --check
```

## 5. 下一阶段

1. 用户执行 R9 Android 真机验收。
2. 根据真机反馈修复后收尾 R9。
3. 最终 Android 回归与 R9 验收合并执行。

## 6. 验证与约束

R8 收尾验证已通过：

```powershell
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/eslint/bin/eslint.js <changed-ts-files>
node node_modules/jest/bin/jest.js --passWithNoTests
git diff --check
```

R8 Android 真机已由用户构建验收通过。

禁止：提交 `run.md` / `testresult.md`、新增运行时依赖、混入当前阶段之外需求、整仓格式化。

## 7. 注意事项

- `lint-staged` 钩子可能在 commit 时自动 `git add .`，提交前需确认没有带入 `run.md` / `testresult.md`。
- 仓库已提交 `.gitattributes` 统一文本换行规则；Windows 下仍需用 `git diff --cached --check` 复核提交内容。
- 临时来源展示是纯会话态 atom；歌单偏好持久化但不进入备份；空结果抑制是内存态。
- 插件来源关系持久化但不进入备份 / 恢复。
