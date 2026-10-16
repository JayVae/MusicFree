# MusicFree Fork Handoff

更新时间：2026-10-16
当前状态：R1/R2、R3、R4、R5、R6 已验收通过；R7 代码实现、反馈修复与静态验证完成，代码阶段收尾，Android 真机验收待用户执行；最终 Android 回归顺延到 R8 / R9 之后。

## 1. 分支

R7 当前分支：

```text
feat/0.6.2-playback-source-adaptive
```

R7 已提交：

```text
02f25c0 feat: enhance playback source continuity
59a0c39 fix: clarify batch source selection
57db54d fix: reuse resolved temporary sources
```

R8 开始时从 R7 收尾分支创建：

```text
feat/0.6.2-plugin-source-groups
```

R9 开始时从 R8 收尾分支创建：

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

## 3. 下一阶段

1. R8：插件安装来源分组与组级状态。
2. R9：插件管理中测试勾选插件可用性并自动标注。
3. R8 / R9 都完成后执行最终 Android 回归。

R9 已确认基础口径：

- 测试入口作用于插件管理中勾选的插件。
- 使用搜索和取源作为可用性探测；任一探测成功即视为插件有效。
- 探测超时 5 秒；搜索和取源都失败时自动置为临时不可用。
- 其余执行口径见 `docs/fork-requirements.md` 第 20 章；实现前必须先确认。

## 4. 验证与约束

R7 收尾验证已通过：

```powershell
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/eslint/bin/eslint.js <changed-ts-files>
node node_modules/jest/bin/jest.js --passWithNoTests
git diff --check
```

Android 真机由用户构建验收。

禁止：提交 `run.md` / `testresult.md`、新增运行时依赖、混入当前阶段之外需求、整仓格式化。

## 5. 注意事项

- `lint-staged` 钩子可能在 commit 时自动 `git add .`，提交前需确认没有带入 `run.md` / `testresult.md`。
- Windows CRLF 环境下，`git diff --check` 可能对 LF 文件误报；提交内容用 `git diff --cached --check` 复核。
- 临时来源展示是纯会话态 atom；歌单偏好持久化但不进入备份；空结果抑制是内存态。
