# AGENTS.md

本文件面向在本仓库继续开发的编码代理。开始新需求前，先阅读本文件与 `handoff.md`。

## 项目概况

- MusicFree 个人 fork，基于上游 `v0.6.2`，当前版本 `v0.6.5`。
- 技术栈：React Native `0.76.5`、React `18.3.1`、TypeScript、Jotai、MMKV。
- 平台优先级：Android；iOS 不作为验收目标。
- 仅维护个人 fork，不向上游仓库提 PR。
- 第一版以来约束：不新增运行时依赖、不做整仓格式化、不提交 `run.md` / `testresult.md`。

## 必读文档

| 文档 | 用途 |
|---|---|
| `handoff.md` | 当前状态、已验收需求、关键实现与发布记录 |
| `docs/PLAN.md` | 阶段计划、分支、状态与变更日志 |
| `docs/fork-requirements.md` | 需求口径、实现记录与验收标准 |
| `docs/decisions.md` | 已确认决策 D1-D70，冲突时以此为准 |

## 开发流程

1. 一个需求一个分支，基于最新 `master` 或已验收收尾分支创建，例如 `feat/0.6.5-plugin-xxx`。
2. 先补充文档，再实现代码：
   - `docs/PLAN.md`：新增阶段行、阶段详情、变更日志。
   - `docs/fork-requirements.md`：新增需求章节、已确认口径、验收标准。
   - `docs/decisions.md`：新增决策编号，不删除历史决策。
   - `handoff.md`：更新当前状态与关键实现。
3. 实现后执行静态验证、构建验证和自测，再做代码 review。
4. 文档与代码分开提交；提交后等待用户在 Android 真机验收。
5. 验收通过后更新收尾文档，合并 `master`、打 tag、推送并发布。

## 常用命令

在 Windows 上优先使用 Git Bash（`shell: bash`）。

```bash
# TypeScript
node node_modules/typescript/bin/tsc --noEmit --pretty false

# ESLint（优先只检查改动文件）
node node_modules/eslint/bin/eslint.js <changed-ts-files>

# Jest
node node_modules/jest/bin/jest.js --passWithNoTests

# 空白与换行检查
git diff --check
git diff --cached --check

# Android debug 构建
cd android
GRADLE_USER_HOME="$USERPROFILE/.gradle" ./gradlew assembleDebug

# Metro 生产打包
node node_modules/react-native/cli.js bundle \
  --platform android --dev false --entry-file index.js \
  --bundle-output /tmp/index.android.bundle --assets-dest /tmp/assets
```

**APK 构建约束**：

- 普通 `src/` JavaScript / TypeScript 改动不主动构建 Debug APK，使用 Metro 热更新或用户现有 Debug 包验证。
- 只有涉及 `android/`、`ios/`、`package.json` 中的原生库、`app.json` 或其他原生 / 构建配置时，才提醒用户构建 Debug APK。
- 上述原生 / 配置变更默认由用户构建；代理不主动执行 Android debug / release 构建，除非用户明确要求。

**Metro 生产打包约束**：

- 默认不执行 Metro production bundle。
- 仅在以下情况执行：改动入口 / 打包配置 / 依赖 / 公共模块；用户要求提测；发布前验证；怀疑生产模式问题。
- 每次执行或跳过都应在最终报告中说明状态、原因和结果。

## 目录与职责

```text
src/core/pluginManager/
  index.ts              插件安装 / 更新 / 订阅安装队列、超时与来源记录
  plugin.ts             插件沙箱执行、懒加载与元数据缓存
  subscription.ts       订阅配置、订阅记录与信息持久化
  subscriptionInstall.ts 订阅安装进度与取消（会话态）
  pluginOrigin.ts       订阅 / 本地 / 网络 / 内置来源分组
  health.ts             插件健康状态与隔离
  meta.ts               插件元数据、用户变量与启用状态
src/core/
  mediaSourceResolver.ts 换源候选、预算与严格匹配
  playbackSource.ts      歌单来源偏好与临时来源
  mediaSourceBatch.ts    批量换源
  trackPlayer/           播放状态、错误事件与换源接入
  appConfig.ts           配置读写与响应式读取
  i18n/                  多语言
src/pages/setting/settingTypes/pluginSetting/
  views/                 插件列表、订阅详情、来源详情
  components/            插件项、订阅安装横幅等
src/components/dialogs/  弹窗组件与注册表
src/types/core/          核心服务与 i18n 的类型声明
```

## 代码约定

- 4 空格缩进、双引号、分号、尾随逗号；遵循 `.eslintrc.js`。
- 路径别名使用 `@/`。
- 非组件逻辑优先放在 `src/core`，UI 只读取状态并触发动作。
- 跨组件会话状态使用 Jotai atom；非组件代码通过 `getDefaultStore()` 读写。
- 持久化使用 MMKV，明确区分持久数据与会话态；新增持久字段前确认是否进入备份。
- 网络请求必须设置明确超时，单个插件失败不得中断整体流程。
- 不在 UI 中硬编码颜色，使用 `useColors()`；复用 `ListItem`、`Checkbox`、`ThemeText`、`TextButton`、`Dialog` 等基础组件。
- 新增弹窗需在 `src/components/dialogs/components/index.ts` 注册，使用 `showDialog("<Name>", props)`。
- 新增 i18n 文案必须同时更新：
  - `src/core/i18n/languages/zh-cn.json`
  - `src/core/i18n/languages/en-us.json`
  - `src/core/i18n/languages/zh-tw.json`
  - `src/types/core/i18n/index.d.ts`
- 新增或修改 `IPluginManager` 方法时同步更新 `src/types/core/pluginManager/index.d.ts`。

## 插件系统注意事项

- 第三方插件代码不可信：不要分析、修改或依赖其内部实现。
- 安装插件时会同步执行插件代码以获取 `platform` / `version` 并计算 hash；混淆插件可能长时间占用 JS 线程。
- 不要一次性同步安装大量插件。订阅安装必须后台串行、提供进度与取消，并在插件之间让出 JS 线程。
- `installQueue` 与 `subscriptionUpdateQueue` 是两条独立串行队列，避免并发安装冲突。
- `plugin.ts` 中存在全局 `axios.defaults.timeout = 2000`；订阅相关请求应显式指定超时覆盖默认值。
- 订阅配置存于 `plugin.subscribeUrl`，格式为 `{ id, name, url }[]`；`.json` 订阅先拉取插件候选列表。
- R10 已交付行为：
  - 添加 `.json` 订阅先展示插件列表供勾选，默认全选。
  - 安装后台执行，单个插件下载 / 列表拉取超时 15 秒。
  - 取消在当前插件完成后生效。
  - 单订阅更新默认勾选已安装插件；“更新全部订阅”只更新已安装插件。

## Git 与发布

- 提交信息遵循 Conventional Commits，例如：
  - `feat(plugin): ...`
  - `fix(plugin): ...`
  - `docs(requirements): ...`
  - `chore(release): ...`
- Husky + lint-staged 可能在提交时执行 `git add .`；提交前用 `git status` 与 `git diff --cached --check` 确认未带入无关文件。
- `.gitattributes` 规定 `.ts/.tsx/.js/.json/.md` 使用 LF；不要重新引入 CRLF。
- 发布流程：
  1. 更新 `package.json`、`package-lock.json` 根版本号与 `release/version.json`。
  2. 更新 `readme.md` / `readme-en.md` 版本与变更说明。
  3. 合并到 `master`（建议 `--no-ff`）。
  4. 打 annotated tag：`git tag -a vX.Y.Z -m "..."`。
  5. 推送 `master` 与 tag；`.github/workflows/build-release.yml` 会构建 APK 并发布 GitHub Release。
  6. 用 GitHub API 或 Actions 页面确认 Release 与 APK 资产上传成功。
- Android `versionCode` 由 `package.json` 版本计算：`X.Y.Z => X*1000000 + Y*1000 + Z`。

## 当前状态

- R1/R2、R3、R4、R5、R6、R7、R8、R9、R10、R11 均已验收通过。
- `v0.6.5` 已发布，Release 包含 5 个 APK 与 `SHA256SUMS.txt`。
- 后续新需求应继续遵守“一需求一分支、文档先行、真机验收、验收后发布”的流程。
