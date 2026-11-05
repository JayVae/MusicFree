# MusicFree Fork Handoff

更新时间：2026-11-05
当前状态：R1/R2、R3、R4、R5、R6、R7、R8、R9、R10、R11 与最终 Android 回归均已验收通过；v0.6.5 已发布。

## 1. 分支

最终回归分支：

```text
feat/0.6.2-final-regression
```

该分支基于 R9 收尾分支 `feat/0.6.2-plugin-availability-test` 创建；已核对 R9 分支线性包含前序已验收需求分支代码。

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

R9 已验收分支：

```text
feat/0.6.2-plugin-availability-test
```

R9 已提交：

```text
d72e3f7 feat(plugin): add availability testing
fbfca97 fix(plugin): refine availability selection
ed969e9 fix(plugin): relocate batch availability test
c722322 fix(plugin): optimize availability selection list
c98c243 fix(plugin): fix list key and selection area
2a5c377 fix(plugin): keep unchecked plugins metadata only
67b043c refactor(plugin): move sort entry near installed actions
``n
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

## 4. R9 收尾结论

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
9. 批量测试使用稳定回调和稳定列表 key；插件健康状态按单个插件订阅，插件头部除启用开关外的区域均可切换选中；来源分组等非安装分组不会误用 installed 列表 key。
10. 启动只恢复插件元数据用于展示；已取消勾选插件不执行代码、不参与搜索 / 取源，仅在没有历史元数据时提取一次基本信息。
11. “调整插件顺序”入口移动到已安装插件标题下方，并位于批量测试插件之前。

关键实现：

- `src/core/pluginAvailability.ts`：探测状态、串行测试和超时判定。
- `src/core/pluginManager/index.ts`：启动仅恢复元数据，未勾选插件不执行代码。
- `src/core/pluginManager/health.ts`：双失败直接进入 `quarantined`。
- `src/pages/setting/settingTypes/pluginSetting/views/pluginList.tsx`：勾选、测试入口、取消和汇总。
- `src/pages/setting/settingTypes/pluginSetting/components/pluginItem.tsx`：勾选框与测试状态标签。

验收记录：

静态验证通过，Android 真机已由用户构建验收通过。

静态验证命令：

```powershell
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/eslint/bin/eslint.js src/core/pluginAvailability.ts src/core/pluginManager/health.ts src/pages/setting/settingTypes/pluginSetting/components/pluginItem.tsx src/pages/setting/settingTypes/pluginSetting/views/pluginList.tsx
node node_modules/jest/bin/jest.js --passWithNoTests
git diff --check
```

## 5. 最终回归结论

1. 已创建 `feat/0.6.2-final-regression` 并完成 Android debug 构建、安装和真机启动。
2. 最终 Android 真机回归已由用户于 2026-10-16 验收通过。
3. 回归覆盖播放换源、批量换源、插件健康、订阅与来源分组、下载历史、插件元数据先行启动、批量可用性测试和常规 Android 播放链路。
4. 未新增运行时依赖，未提交 `run.md` / `testresult.md`。
5. 无剩余待执行阶段。

## 6. 验证与约束

最终回归验证已通过：

```text
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/jest/bin/jest.js --passWithNoTests
node node_modules/eslint/bin/eslint.js <changed-ts-files>
git diff --check
cd android && ./gradlew assembleDebug
GRADLE_USER_HOME="$USERPROFILE/.gradle" npx react-native run-android
```

ESLint 最终结果为 0 errors / 29 warnings；Android debug 构建成功，APK 已安装到真机 `PJE110` 并启动。

R9 Android 真机已由用户构建验收通过。

禁止：提交 `run.md` / `testresult.md`、新增运行时依赖、混入当前阶段之外需求、整仓格式化。

## 7. 注意事项

- `lint-staged` 钩子可能在 commit 时自动 `git add .`，提交前需确认没有带入 `run.md` / `testresult.md`。
- 仓库已提交 `.gitattributes` 统一文本换行规则；Windows 下仍需用 `git diff --cached --check` 复核提交内容。
- 普通 `src/` JavaScript / TypeScript 改动不主动构建 Debug APK；只有涉及 `android/`、`ios/`、`package.json` 原生库、`app.json` 等原生 / 构建配置时，提醒用户自行构建。
- Metro 生产打包默认不执行；仅在改动入口 / 打包配置 / 依赖 / 公共模块、用户要求提测、发布前验证或怀疑生产模式问题时执行，并在报告中说明是否执行、原因和结果。
- 临时来源展示是纯会话态 atom；歌单偏好持久化但不进入备份；空结果抑制是内存态。
- 插件来源关系持久化但不进入备份 / 恢复。
- R9 可用性测试明细和汇总是会话态；双失败写入的 `quarantined` 继续按 R3 持久化。
- 启动阶段未勾选插件仅恢复元数据；首次服务调用才完整挂载，不参与搜索 / 取源。

## 8. v0.6.3 发布准备

1. 功能分支已推送；`release/0.6.3` 已合入 `master`，合并冲突重点保留 master 稳定性修复与 fork 功能实现。
2. 版本号提升为 `0.6.3`；Android `versionCode` 改为语义化计算（`0.6.3 => 603000`）。
3. 新增 `.github/workflows/build-release.yml`：`v*` tag 推送触发，构建 release APK、生成 SHA256、上传 Artifact 并发布 GitHub Release。
4. 签名策略：配置 `RELEASE_KEYSTORE_BASE64` / 密码 / alias Secrets 时用正式签名；否则回退仓库 debug keystore，保证个人可安装。
5. 合并后验证：`tsc`、Jest、ESLint 0 errors、Android release 增量构建成功。

## 9. R10 订阅导入与安装流程优化（2026-10-31）

分支：`feat/0.6.3-subscription-install`（基于 `master` / v0.6.3）。

问题背景：添加或更新 `https://update.summerbug.dpdns.org/musicfree/plugins.json` 时卡死；该订阅含 57 个插件，原流程串行下载并同步挂载全部插件，阻塞 JS 线程。

已实现：

1. `.json` 订阅添加先拉取插件列表，弹出勾选对话框，默认全选，支持全选 / 全不选。
2. 安装改为后台串行执行，页面不再等待全部完成；插件间让出 JS 线程。
3. 单订阅更新同样先展示列表，默认勾选已安装插件；更新全部订阅只更新已安装插件。
4. 单个插件下载与订阅列表拉取超时 15 秒；单插件失败只记录结果并继续。
5. 提供会话态进度与取消入口，取消在当前插件完成后生效。
6. 订阅配置添加时立即保存；列表拉取失败保留空订阅组。

关键实现：

- `src/core/pluginManager/index.ts`：候选列表、后台安装、取消、15 秒超时。
- `src/core/pluginManager/subscriptionInstall.ts`：安装进度会话态。
- `src/components/dialogs/components/subscriptionInstallDialog.tsx`：插件勾选。
- `src/pages/setting/settingTypes/pluginSetting/components/subscriptionInstallBanner.tsx`：进度 / 取消横幅。

验证：`tsc`、ESLint、Jest、`git diff --check`、Android `assembleDebug` 与 Metro production bundle 均通过；Android 真机验收通过。

收尾（2026-10-31）：已合并到 `master`，版本提升为 `0.6.4`，打 tag `v0.6.4` 并推送远程，由 GitHub Actions 构建并发布 Release。

## 10. R11 旧音源替换（2026-11-05，已发布）

分支：`feat/0.6.5-source-replacement`（基于 `master` / v0.6.4）。

问题背景：旧歌单、播放历史、本地音乐和下载历史可能长期保留已删除 / 失效音源 A 的 `platform`。现有音源重定向依赖 A 插件仍存在，无法处理插件已删除的情况，播放和下载会反复进入失败与换源流程。

已确认口径：

1. 按音源 `platform` 保存 `A -> B` 替换关系；同名插件走一次性重匹配，不保存 `A -> A` 自映射。
2. 选择 B 后通过搜索严格匹配并验证取源，命中后把歌曲元数据迁移为 B；未命中保留原值。
3. 元数据迁移保留歌单时间戳、排序信息、本地路径和下载状态。
4. 替换页展示所有引用音源，歌单菜单提供批量重新匹配入口。
5. 播放 / 下载遇到映射时优先用目标插件搜索，不把旧 ID 直接交给目标插件取源。
6. 来源组支持删除组内全部插件；订阅组只卸载插件，不删除订阅配置。
7. 映射使用独立 MMKV，重启保留，不进入备份 / 恢复。

实现记录：

- `src/core/sourceMigration.ts`：严格搜索、候选取源验证、元数据合并与多存储写回。
- `src/core/pluginManager/sourceReplacement.ts`：映射持久化与全音源引用收集。
- 播放失败候选优先尝试映射目标；播放 / 下载不会直接用旧 A 元数据调用 B。
- `pluginSourceReplacement.tsx` 和歌单菜单提供全局 / 单歌单重新匹配入口。
- 来源组详情增加整组删除插件。

验证记录（2026-11-05）：

- 修订后 `tsc --noEmit`、改动文件 ESLint（0 errors / 5 个既有 warning）、Jest、`git diff --check` 和 Metro Android production bundle 通过。
- 本轮仅 JavaScript / TypeScript 改动，未重新构建 Debug APK；等待用户使用 Metro / 现有 Debug 包验证。
- 验收前不合并、不发布。

运行时警告处理（2026-11-05）：

- 排序列表滚动状态改用 Reanimated shared value，消除 worklet 修改 React ref `current` 的警告。
- 文件选择器 callback 迁移到模块级 action registry，navigation 参数保持可序列化；同时移除对应的 `LogBox` 忽略项。
- 下载列表增加外层布局容器和 `estimatedItemSize`，不再给 FlashList 直接传 `style`。
- 本轮仍仅涉及 JavaScript / TypeScript，不主动构建 Debug APK；等待用户在现有 Debug 包 / Metro 中复验。
- `tsc --noEmit`、改动文件 ESLint（0 errors / 7 个既有 warning）、Jest、`git diff --check` 和 Metro Android production bundle 通过。

验收记录（2026-11-05）：

- 用户已完成 R11 旧音源替换、同名源重匹配、歌单批量替换、来源组整组删除及运行时 warning 的 Android 真机验收。
- 版本提升为 `0.6.5`；`v0.6.5` tag 触发的 GitHub Actions 已成功发布 5 个 APK 与 `SHA256SUMS.txt`。
- 收尾阶段未再次执行 Metro production bundle：最后一批功能代码完成后已通过生产打包，之后仅修改文档和发布元数据。
