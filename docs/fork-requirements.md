# MusicFree Fork 需求与技术调查记录

- 记录日期：2026-10-14
- 状态：实施中；R3 与 R1/R2 已完成，R6 已纳入后续需求
- 代码基线目标：`v0.6.2`
- 范围：个人 fork，自定义功能，不计划向原仓库提 PR
- 平台优先级：Android 优先；iOS 暂不作为验收目标
- 约束：本文档记录需求与方案；实现前仍需确认“待确认问题”

---

## 1. 结论摘要

1. 当前仓库工作区干净，当前分支为 `master`，HEAD 是 `d118b18b3d0c904400f7eea7bf99c0ceec6c1aee`。
2. 严格意义上的 `v0.6.2` 是 `b3cb5e5829dc600af86731c582429f5eb99cad27`。
3. 当前 `master` 是 `v0.6.2` 之后 6 个 commit，并被 `v1.0.0-beta.1/.2/.3` 指向；这些 commit 主要是 README、版本说明、备份容错、插件初始化提示跨平台化、日志容错，没有实现本文件中的目标功能。
4. `v0.6.3-beta.0/.1` 是从 `v0.6.2` 分出的另一条 beta 线，包含歌单编辑器、插件懒加载默认化、遥测、样式等改动；经核对，相关核心文件中没有实现本文目标中的“运行时播放失败换源”“插件失效生命周期管理”“下载结果历史”等新功能。
5. `v0.6.2` 中已经存在部分旧能力：
   - 插件可以设置“音源重定向 / 替代插件”。
   - 设置项 `basic.tryChangeSourceWhenPlayFail` 已经存在，默认关闭。
   - 无有效源时会尝试在其他插件中搜索相似歌曲。
6. 本次开发应从 `v0.6.2 = b3cb5e5` 新建功能分支，而不是直接基于当前 `master`。
7. 用户已确认播放失败换源要覆盖两类场景：
   - 插件无法获取到有效 URL；
   - 已获取 URL 后，底层播放器播放失败。
8. 自建歌单不做独立播放回退配置，统一使用全局播放回退策略。
9. 下载需求简化为：可以查看下载成功 / 失败情况；第一版不新增依赖，不做系统通知。
10. 插件管理将作为独立需求展开，包括失效标记、临时不可用、归档、重复插件分组、订阅更新失败状态等。
11. 新增 R6：插件启动加载与播放状态恢复优化。目标是启动时只恢复插件元数据、不执行插件代码，并避免被动恢复播放状态触发取源或歌词搜索。

---

## 2. Git 基线与 beta 核查

### 2.1 关键 commit

| 对象 | commit | 说明 |
|---|---|---|
| `v0.6.2` | `b3cb5e5829dc600af86731c582429f5eb99cad27` | 目标开发基线 |
| 当前 `master` | `d118b18b3d0c904400f7eea7bf99c0ceec6c1aee` | 同时是 `v1.0.0-beta.1/.2/.3` |
| `v0.6.3-beta.0` | `64432958dc21ace10f2bd166910199a6295cb8f4` | 从 `v0.6.2` 分出的后续 beta |
| `v0.6.3-beta.1` | `a079d8f9bcc1dad67902871c5330095b4cdd25c7` | 当前 `origin/dev` 也指向此 commit |

### 2.2 基线安全性核查

`v0.6.2..v1.0.0-beta.3` 的源码差异只涉及：

```text
readme-en.md
readme.md
release/version.json
src/core/backup.ts
src/core/pluginManager/index.ts
src/utils/log.ts
```

没有修改：

```text
src/core/trackPlayer/index.ts
src/core/downloader.ts
src/core/musicSheet/index.ts
src/core/pluginManager/plugin.ts
```

因此，基于 `v0.6.2` 开发不会丢失当前 `v1.0.0-beta.*` 中与本次目标相关的逻辑。

`v0.6.2..v0.6.3-beta.1` 对相关文件有改动，但主要是无关重构和修复：

```text
src/core/musicSheet/index.ts
src/core/pluginManager/index.ts
src/core/pluginManager/plugin.ts
src/core/trackPlayer/index.ts
src/pages/setting/settingTypes/basicSetting.tsx
```

未发现它实现：

- 运行时播放失败后系统性换源；
- 插件临时失效 / 手动失效 / 归档状态机；
- 下载成功 / 失败历史；
- 下载系统通知。

### 2.3 建议分支策略

后续实现时建议：

```bash
git switch -c feat/0.6.2-custom b3cb5e5829dc600af86731c582429f5eb99cad27
```

不合并 `v0.6.3-beta.*`，除非未来明确需要其中某些无关改动，并且单独评估冲突。

---

## 3. 当前项目与相关实现调查

### 3.1 技术栈概览

| 类别 | 技术 |
|---|---|
| 框架 | React Native `0.76.5`，React `18.3.1` |
| 语言 | TypeScript `^5.3.3` |
| 状态 | Jotai、class service、EventEmitter |
| 播放器 | `react-native-track-player ^4.1.1` |
| 存储 | `react-native-mmkv` |
| 文件 | `react-native-fs` |
| 插件 | CommonJS 插件，由 `PluginManager` 加载 |
| 平台 | Android 优先；仓库保留 iOS 工程，但本次不做 iOS 验收 |

### 3.2 核心入口与目录

```text
index.js
src/entry/index.tsx
src/entry/bootstrap/bootstrap.ts
src/core/trackPlayer/index.ts
src/core/pluginManager/index.ts
src/core/pluginManager/plugin.ts
src/core/pluginManager/meta.ts
src/core/musicSheet/index.ts
src/core/musicSheet/storage.ts
src/core/downloader.ts
src/pages/downloading/downloadingList.tsx
src/service/index.ts
```

启动时依赖注入位于：

```text
src/entry/bootstrap/bootstrap.ts
```

关键关系：

```ts
TrackPlayer.injectDependencies(Config, musicHistory, PluginManager);
downloader.injectDependencies(Config, PluginManager);
```

### 3.3 播放链路现状

核心文件：

```text
src/core/trackPlayer/index.ts
```

关键逻辑：

| 位置 / 方法 | 说明 |
|---|---|
| `play()` | 核心播放入口 |
| `Event.PlaybackError` | 捕获底层播放错误 |
| `handlePlayFail()` | 播放失败后决定是否自动下一曲 |
| `getSimilarMusic()` | 在其他插件中搜索相似歌曲 |
| `skipToNext()` / `skipToPrevious()` | 队列切换 |
| `changeQuality()` | 切换音质 |

当前已有回退流程：

1. 按音质顺序调用原插件 `getMediaSource`。
2. 如果失败，尝试 `musicItem.source` 中已有源。
3. 如果仍无源，且 `basic.tryChangeSourceWhenPlayFail` 开启，则调用 `getSimilarMusic()`。
4. 找到相似歌曲后，用其他插件解析 URL。
5. 结果仍合并回原始歌曲身份，保持 `id` / `platform` 不变。
6. 全部失败则 `INVALID_SOURCE`，最终可能跳下一曲。

当前不足：

1. `basic.tryChangeSourceWhenPlayFail` 默认关闭。
2. 底层 `Event.PlaybackError` 目前主要触发 `handlePlayFail()`，不会系统性地记录候选并继续尝试同一首歌的其他源。
3. 源码注释明确说明 `PlaybackError` 不稳定，错误发生时 active track 可能已经变化。
4. 缺少统一候选管理、失败候选去重、超时控制、插件健康状态联动。

### 3.4 插件管理现状

核心文件：

```text
src/core/pluginManager/index.ts
src/core/pluginManager/plugin.ts
src/core/pluginManager/meta.ts
src/pages/setting/settingTypes/pluginSetting/*
```

当前身份模型：

| 字段 / 概念 | 当前含义 |
|---|---|
| `plugin.name` | 插件 platform 名称，也作为大量 meta 的 key |
| `plugin.hash` | 插件文件内容 SHA-256 |
| `plugin.path` | 本地插件文件路径 |
| `plugin.instance.version` | 插件自身版本 |
| `plugin.instance.srcUrl` | 插件更新 URL |
| `plugin.state` | `Initializing` / `Loading` / `Mounted` / `Error` |

当前行为：

1. 相同 `hash` 的插件再次安装会被静默忽略。
2. 相同 `name` 的插件安装时，如果旧版本更新，默认拒绝安装低版本。
3. 相同 `name` 且版本不低于旧版本时，会替换旧插件。
4. 插件启用 / 禁用状态按 `plugin.name` 存储在 `plugin-meta` MMKV。
5. 插件排序也按 `plugin.name` 存储。
6. “替代插件 / 音源重定向”按插件名称配置。
7. 订阅链接保存在 `plugin.subscribeUrl`，当前只是 URL 列表，没有订阅级更新状态持久化。
8. 更新失败信息主要是安装流程中的临时返回结果，没有长期健康状态。

### 3.5 歌单现状

核心文件：

```text
src/core/musicSheet/index.ts
src/core/musicSheet/storage.ts
src/components/panels/types/createMusicSheet.tsx
src/components/musicSheetPage/components/sheetMusicList.tsx
```

结论：

- 自建歌单最终仍通过 `TrackPlayer.play()` / `TrackPlayer.playWithReplacePlayList()` 播放。
- 如果换源做在 TrackPlayer 全局层，自建歌单自然继承该能力。
- 用户已确认不需要按歌单单独配置。

### 3.6 歌曲元数据现状

远程歌曲元数据由插件返回，主要字段：

```ts
id
platform
title
artist
alias
duration
album
artwork
url
source
qualities
lyric
```

这不是标准 ID3。只有本地音乐可能带有本地路径或部分 media extra，远程歌曲没有统一的 ID3 保证。
因此相似歌曲匹配只能基于插件返回的结构化元数据，不能假设 ID3 存在。

### 3.7 下载器现状

核心文件：

```text
src/core/downloader.ts
src/pages/downloading/downloadingList.tsx
```

已有状态：

```ts
enum DownloadStatus {
  Pending,
  Preparing,
  Downloading,
  Completed,
  Error,
}
```

已有能力：

1. 并发下载数量限制。
2. 下载临时文件，完成后移动到目标目录。
3. `react-native-fs.downloadFile` 提供 `begin` / `progress` 回调。
4. 下载页显示已下载大小和总大小。
5. 完成后会加入本地音乐库。

当前不足：

1. 任务记录主要在内存中。
2. 成功任务完成后会从下载队列移除，用户不能在下载页回看“曾经成功”的历史。
3. 应用重启后未完成任务和状态会丢失。
4. 没有持久化下载结果历史。

---

## 4. 已确认决策

| 编号 | 决策 |
|---|---|
| D1 | 基线采用 `v0.6.2 = b3cb5e5`。前提已核查：后续 beta 没有实现本次目标功能。 |
| D2 | 播放失败换源同时覆盖“取源失败”和“底层播放失败”。 |
| D3 | 候选插件优先级使用插件排序优先级。 |
| D4 | 相似歌曲匹配采用严格匹配为默认策略。 |
| D5 | `basic.tryChangeSourceWhenPlayFail` 在本 fork 中默认开启。 |
| D6 | 自建歌单不做独立回退设置，使用全局策略。 |
| D7 | 换源成功结果做缓存，并提供可选清理。 |
| D8 | 下载需求简化：优先实现可查看成功 / 失败情况。 |
| D9 | 第一版不新增通知相关依赖，不做系统通知。 |
| D10 | Android 优先，iOS 暂不验收。 |
| D11 | 只维护个人 fork，不向原仓库推送。 |
| D12 | 后续可用 Android 真机验证。 |
| D38 | R6 作为独立后续需求，不改变已确认的 R3 -> R1/R2 -> R5 -> R4 顺序。 |
| D39 | 插件启动阶段只恢复元数据；不因索引或列表展示执行插件代码，首次服务调用时再挂载。 |
| D40 | 未开启“软件启动时自动播放”时，启动恢复只还原队列、当前歌和进度，不主动请求真实音源。 |
| D41 | 歌词自动搜索延迟到启动图隐藏后，并按歌曲做单飞和缓存，避免重复搜索。 |
| D42 | 换源候选只从已启用、可搜索且健康状态为 `available` 的插件中选择；不可用插件直接排除，不降级排序到尾部。 |
| D43 | 换源停止条件为任一条件先满足：候选耗尽、已尝试 5 个、15 秒预算到期、当前歌曲切换。 |

---

## 5. 需求拆解

### R1. 播放失败自动切换其他可用音源

#### 目标

用户播放一首歌时，如果当前插件或当前 URL 失败，应自动尝试其他可用插件中的可用音源；全部失败后再按现有规则暂停或跳下一曲。

#### 范围

必须覆盖：

1. 插件解析不到有效 URL；
2. 已经得到 URL，但底层播放失败。

#### 建议架构

新增集中式换源解析器，建议文件方向：

```text
src/core/mediaSourceResolver.ts
```

候选顺序：

1. 原始 `musicItem.url` / `musicItem.source`；
2. 原插件按全局音质顺序解析；
3. 原插件配置的替代插件；
4. 其他可用插件按插件排序尝试；
5. 对候选插件执行严格相似歌曲匹配；
6. 匹配成功后解析该候选歌曲音源；
7. 成功后返回统一的 `ResolvedSource`。

候选解析结果至少包含：

```ts
sourceUrl
headers
userAgent
quality
resolvedByPluginName
candidateMusicItem
sourceIdentity
```

#### 运行时播放失败处理

1. `Event.PlaybackError` 中读取 active track。
2. 忽略 `fakeAudioUrl` / `proposedAudioUrl`。
3. 校验当前逻辑歌曲是否仍是目标歌曲，避免快速切歌误处理。
4. 记录已失败的 URL / 插件 / 音质组合。
5. 如果还有候选，重新设置 track source。
6. 如果没有候选，执行现有失败策略：暂停或跳下一曲。
7. 必须有最大尝试次数和总时间预算，避免长时间阻塞队列。

#### 配置

新增或调整配置：

```ts
basic.tryChangeSourceWhenPlayFail = true; // 默认开启
basic.playSourceFallbackStrictMatch = true;
basic.playSourceFallbackMaxCandidates;
basic.playSourceFallbackTimeoutMs;
```

是否全部暴露到设置页待确认。第一版可以只默认开启并使用内置保守值。

#### 缓存策略

用户已确认：缓存 + 可选清理。

建议：

1. 成功换源后记录：
   - 原歌曲 `platform + id`；
   - 实际候选歌曲身份；
   - 插件名；
   - URL；
   - headers / UA；
   - 音质；
   - 成功时间；
   - 失效或过期时间。
2. 优先存内存，或存入独立 MMKV。
3. 不改写自建歌单原始歌曲数据。
4. 提供清理入口，例如：
   - 清理全部换源缓存；
   - 清理某首歌的换源缓存；
   - 或先复用全局缓存清理。

#### 严格匹配建议

默认严格匹配：

1. `title` 规范化后完全一致；
2. `artist` 规范化后一致；
3. 可选校验 `duration` 差值不超过阈值；
4. 默认不使用编辑距离；
5. `alias` 可以参与标题候选，但不能单独放宽匹配。

是否强制校验 `album` 待确认。

#### 影响文件

```text
src/core/trackPlayer/index.ts
src/core/mediaSourceResolver.ts
src/core/pluginManager/index.ts
src/core/pluginManager/plugin.ts
src/types/core/config.d.ts
src/types/core/trackPlayer/index.d.ts
src/pages/setting/settingTypes/basicSetting.tsx
src/core/i18n/languages/zh-cn.json
src/core/i18n/languages/zh-tw.json
src/core/i18n/languages/en-us.json
src/types/core/i18n/index.d.ts
```

#### 风险

1. `Event.PlaybackError` 不稳定，可能拿到已变化的 track。
2. 不同插件返回的元数据质量参差不齐，严格匹配可能导致命中率偏低。
3. 多插件串行尝试会拖慢切歌。
4. 后台 JS 或网络受限时，多候选重试可能失败。
5. 失败候选如果缓存不当，后续会重复失败。
6. 需要避免和 `autoStopWhenError` / `skipToNext()` 产生重复跳歌。

#### 验收标准

1. 默认开启换源。
2. 原插件无源时，按插件顺序尝试其他插件。
3. 原插件返回 URL 但底层播放失败时，会继续尝试下一候选。
4. 换源成功后仍显示原歌曲标题 / 作者 / 封面。
5. 换源成功后可正常播放、暂停、切歌、记录历史。
6. 自建歌单原始歌曲数据不被永久改写。
7. 全部候选失败时只触发一次暂停或跳下一曲。
8. 快速切歌时旧任务不会影响新歌曲。
9. 禁用插件、手动失效插件、归档插件不进入候选。
10. 临时不可用插件在 TTL 内不进入候选。

---

### R2. 自建歌单播放失败换源

#### 决策

自建歌单不做独立设置。

#### 设计

R1 的全局换源能力自然覆盖自建歌单。

歌单中的歌曲对象保持原始身份：

```ts
id
platform
title
artist
album
artwork
duration
```

换源成功后只在播放器运行时或独立缓存中保存实际源，不改写歌单数据。

#### 影响文件

主要复用 R1，不需要专门修改歌单核心逻辑。

#### 验收标准

1. 在自建歌单中播放失败歌曲时能自动换源。
2. 换源成功后歌单内歌曲顺序、身份、封面、标题不变。
3. 歌单导出 / 备份不因换源缓存产生额外迁移负担。
4. 多个歌单包含同一首歌时行为一致。

---

### R3. 插件管理与健康状态

这是用户在澄清过程中明确扩展出来的独立需求。

#### 目标

让用户可以管理来自不同订阅或网络来源的插件，处理失效、低版本、重复和更新失败情况。

#### 建议状态模型

插件当前已有 `enabled / disabled`。建议新增独立健康生命周期，不与“禁用”混用：

| 状态 | 含义 | 是否进入换源候选 | 是否进入搜索 | 说明 |
|---|---|---:|---:|---|
| `available` | 正常可用 | 是 | 是 | 默认状态 |
| `disabled` | 用户禁用 | 否 | 否 | 现有能力 |
| `quarantined` | 自动临时不可用 | 默认否 | 可配置 | 有时间和原因，可自动恢复 |
| `userInvalid` | 用户手动标记失效 | 否 | 否 | 必须用户手动恢复 |
| `archived` | 归档 | 否 | 否 | 通常用于低版本、重复或旧来源 |

#### 自动临时不可用

触发条件建议：

1. 插件加载 / 解析失败；
2. 应用版本不匹配；
3. `getMediaSource` 连续多次失败；
4. `search` 连续多次失败；
5. 明确返回无效源、解析异常、平台接口结构变化等插件级错误。

不应触发插件临时不可用的情况：

1. 设备无网络；
2. DNS / TLS / 代理类全局网络错误；
3. 用户禁止移动网络导致请求未发出；
4. 单首歌曲本来就不存在；
5. 订阅 URL 暂时打不开，但插件本地功能可能仍正常。

建议记录：

```ts
pluginHealth = {
  pluginName,
  pluginHash,
  status,
  reason,
  failedAt,
  recoverAt,
  consecutiveFailures,
  lastSuccessAt,
  lastCheckedAt,
}
```

默认策略建议：

1. 连续 3 次插件级失败后进入 `quarantined`。
2. TTL 建议 24 小时，到期可重新参与尝试。
3. 成功后清零失败计数并恢复 `available`。
4. 用户可手动恢复。
5. 手动 `userInvalid` 不自动恢复。

#### 更新失败状态

为插件或订阅记录独立更新状态：

| 状态 | 含义 |
|---|---|
| `unknown` | 尚未检查 |
| `upToDate` | 已是最新 |
| `updated` | 最近更新成功 |
| `updateFailedNetwork` | 网络原因失败 |
| `updateFailedParse` | 下载内容无法解析 |
| `updateFailedVersion` | 版本检查不允许降级 / 不兼容 |
| `updateFailedUnknown` | 其他失败 |

注意：更新失败不应直接等同插件不可用。
网络原因失败只标记更新失败，不把本地插件标记为音源失效。

#### 重复插件与版本处理

当前实现限制：

1. 插件身份主要靠 `name` 和内容 `hash`。
2. 相同 `name` 插件会互相替换。
3. 相同 `hash` 插件会静默去重。
4. 订阅来源目前没有可靠持久化的插件来源关系。

建议第一版采用“逻辑分组 + 单一激活”：

1. 相同 `name` 的插件在 UI 中分组。
2. 同组只保留一个激活插件。
3. 相同 `hash` 直接去重。
4. 版本更高者默认激活。
5. 低版本插件标记 `archived`，默认不参与搜索和换源。
6. 保留低版本文件和元数据，便于回退。
7. 不同来源但相同 `name` 时显示来源 URL / hash 摘要。

不建议第一版尝试真正“合并插件代码”。插件代码不可信且行为可能不同，逻辑合并风险高。

#### 影响文件

```text
src/core/pluginManager/index.ts
src/core/pluginManager/meta.ts
src/core/pluginManager/plugin.ts
src/core/mediaSourceResolver.ts
src/pages/setting/settingTypes/pluginSetting/components/pluginItem.tsx
src/pages/setting/settingTypes/pluginSetting/views/pluginList.tsx
src/pages/setting/settingTypes/pluginSetting/views/pluginSubscribe.tsx
src/types/core/pluginManager/index.d.ts
src/types/plugin.d.ts
src/core/i18n/languages/*.json
src/types/core/i18n/index.d.ts
```

可能新增：

```text
src/core/pluginManager/health.ts
src/core/pluginManager/identity.ts
```

#### 验收标准

1. 插件可手动标记失效并手动恢复。
2. 插件连续失败后自动进入临时不可用。
3. 临时不可用插件不参与换源候选。
4. 临时不可用到期或手动恢复后可重新参与。
5. 无网络时不会把插件错误标记为插件失效。
6. 更新网络失败与插件音源失败分开显示。
7. 相同插件重复来源能分组或去重。
8. 低版本插件可归档且默认不参与候选。
9. 插件排序能影响换源候选顺序。
10. 状态和排序在应用重启后保留。

---

### R4. 下载结果查看

#### 目标

用户可以查看下载成功 / 失败情况。第一版不新增依赖，不做系统通知。

#### 当前问题

现有成功任务会从队列移除，失败任务也主要依赖内存状态；应用重启后无法可靠回看。

#### 建议设计

新增持久化下载结果记录：

```ts
interface IDownloadRecord {
  key: string;
  musicItem: IMusic.IMusicItem;
  quality?: IMusic.IQualityKey;
  status: "success" | "failed" | "removed";
  filename?: string;
  localPath?: string;
  fileSize?: number;
  downloadedSize?: number;
  failReason?: string;
  pluginName?: string;
  createdAt: number;
  finishedAt?: number;
}
```

UI 建议：

1. 下载页增加筛选：全部 / 进行中 / 成功 / 失败。
2. 成功记录显示文件名、大小、时间，可选“定位 / 删除记录”。
3. 失败记录显示失败原因和时间；第一版不提供手动重试按钮。
4. 提供清空历史或清空失败记录。

第一版可以不做：

1. 系统通知；
2. 前台服务；
3. 进程被杀后的断点续传；
4. 失败记录的手动 / 自动重试。

#### 影响文件

```text
src/core/downloader.ts
src/pages/downloading/index.tsx
src/pages/downloading/downloadingList.tsx
src/core/i18n/languages/*.json
src/types/core/i18n/index.d.ts
```

可能新增：

```text
src/core/downloadHistory.ts
```

#### 风险

1. 下载任务和下载历史状态切换需要避免重复写入。
2. 用户删除本地文件后，历史记录不能误标为成功可播放。
3. 应用被杀时，进行中任务只能标记为失败 / 中断，不能假装成功。
4. 长期历史无限增长会影响 MMKV 性能，需要限制条数。

#### 验收标准

1. 下载成功后，历史中能看到成功记录。
2. 下载失败后，历史中能看到失败原因。
3. 应用重启后仍能查看历史结果。
4. 可按成功 / 失败筛选。
5. 可清理历史。
6. 不影响当前下载完成后的本地音乐入库逻辑。
7. 不新增通知依赖。

---

---

### R6. 插件启动加载与播放状态恢复优化

#### 背景

2026-10-14 真机排查发现：

1. 设备插件目录约 48 个 JS 文件、1.8MB。`PluginManager.setup()` 串行读取、eval、计算 hash，实测插件初始化约 3.9-4.9 秒。
2. 现有“启用插件懒加载”仍不足以完全避免启动成本，需要建立更明确的“元数据先行、代码按需挂载”机制。
3. 至少 `小芸音乐`、`WebFilter`、`小蜗音乐` 三个第三方插件源码顶层遗留了 `search("童话镇") -> getMediaSource -> getLyric -> console.log` 调试代码。只要插件代码在启动时被执行，就会产生与用户操作无关的搜索和歌词请求。
4. 启动恢复队列实测为 40 首，当前歌是 Bach/Wagner 等曲目，队列本身没有《童话镇》；该现象不是播放恢复数据错误。
5. 未开启启动自动播放时，现有 `TrackPlayer.setupTrackPlayer()` 仍会异步请求 `getMediaSource()`，可能触发后续换源搜索。

#### 目标

1. 启动图隐藏不等待插件代码挂载。
2. 启动阶段不执行插件顶层调试代码。
3. 插件列表、搜索入口和健康状态展示依赖元数据即可先渲染。
4. 被动恢复播放状态不发起网络搜索。
5. 歌词自动搜索不因启动恢复重复触发。

#### 建议范围

1. 插件元数据先行：
   - 持久化插件名、hash、path、supportedMethods、健康状态等元数据。
   - `PluginManager.setup()` 只恢复元数据，不读取 / eval 插件源码。
   - 首次调用插件方法时再挂载；可选在启动图隐藏后低优先级预挂载可用插件。
2. 插件去重前置：
   - 在执行插件代码前使用缓存 hash / 内容 hash 去重。
   - 重复文件只保留一个挂载实例。
   - 与 R5 的订阅来源、重复插件分组设计保持兼容。
3. 启动播放恢复：
   - 还原播放队列、当前歌、进度、音质和循环模式。
   - `basic.autoPlayWhenAppStart=false` 时只还原状态，不调用 `getMediaSource()`。
   - `basic.autoPlayWhenAppStart=true` 时才按 R1/R2 规则取源。
4. 歌词搜索治理：
   - 启动图隐藏后再刷新歌词。
   - 同一歌曲同一时刻只保留一个相似歌词搜索任务。
   - 按歌曲身份和元数据缓存结果；切歌时取消旧任务。
5. 可观测性：
   - 保留启动阶段耗时日志。
   - 记录插件元数据加载、首次挂载和歌词搜索触发来源，便于后续验收。

#### 非目标

1. 第一版不做插件源码静态审计，也不拦截所有合法插件顶层初始化。
2. 第一版不新增插件静态分析或沙箱依赖。
3. 不修改第三方插件源码；坏插件应通过禁用 / 卸载处理。
4. 不改变 R3 健康状态、R5 订阅和重复插件设计。

#### 影响文件

```text
src/core/pluginManager/index.ts
src/core/pluginManager/plugin.ts
src/core/pluginManager/pluginStartup.ts  # 可选新增
src/core/trackPlayer/index.ts
src/core/lyricManager.ts
src/entry/bootstrap/bootstrap.ts
```

#### 验收标准

1. 安装含顶层网络调试代码的插件后，冷启动阶段不应触发其 `search` / `getMediaSource` / `getLyric`。
2. 启动图隐藏不等待插件代码全部挂载。
3. 插件列表和健康状态能基于元数据展示；首次使用插件时按需挂载。
4. 未开启自动播放时，启动后不出现取源、换源搜索或歌词相似搜索请求。
5. 用户主动播放、搜索、打开歌词时功能不受影响。
6. R3 的 `quarantined` / `userInvalid` / `archived` 过滤继续生效。
7. 重复内容插件不会被重复挂载。
8. Android 冷启动日志能区分“元数据加载”与“插件代码挂载”。

#### 风险

1. 插件元数据缓存与文件内容不一致时，需要检测文件变化并回退到完整挂载。
2. 部分插件依赖顶层初始化；必须保证首次方法调用前完成挂载。
3. 后台预挂载可能重新带来网络请求，应默认受限于可用插件并允许关闭。
4. 歌词缓存 key 需要处理 platform、id、title、artist、duration 缺失的情况。

## 5.x 原始需求中的通知项处理

原始需求包含“下载进度显示和通知”。

当前澄清结果：

1. 下载需求简化，第一版只要能查看成功 / 失败情况。
2. 不新增系统通知依赖。
3. Android 优先。
4. 系统通知推迟到后续版本。

后续如需系统通知，可选方案：

1. 不新增第三方库，手写 Android Kotlin Notification Module；
2. 引入 `notifee`；
3. 若要求后台强持续，则评估 Android Foreground Service。

当前记录为推迟项，不进入第一版实现范围。

---

## 6. Upstream 策略

用户确认：

- 仅个人使用；
- 不推送到原作者仓库；
- 不需要贡献回上游。

建议策略：

1. 保留 `origin` 指向自己的 fork。
2. 可选添加只读 upstream：

```bash
git remote add upstream https://gh-proxy.org/https://github.com/maotoumao/MusicFree.git
```

3. 只 fetch，不自动 merge：

```bash
git fetch upstream --tags
```

4. 后续如果需要参考上游修复，先在独立分支 cherry-pick 或 diff 评估。
5. 不把 `v0.6.3-beta.*` 直接合入功能分支。

是否实际添加 upstream remote 待用户确认。当前尚未添加。

---

## 7. 测试与验收环境

### 环境

1. Android 真机。
2. Windows 本机构建。
3. Node >= 18，建议使用 CI 相同的 Node 20。
4. Java 17。
5. Android SDK。

### 常用命令

```bash
npm ci
npx tsc --noEmit
npx eslint . --ext .js,.jsx,.ts,.tsx src
npm run test
npm run start
npm run android
```

注意：

- `npm run lint` 会自动 `--fix`，可能修改文件。
- 当前仓库没有测试文件。
- 本地 release 构建缺少 keystore 配置时可能失败。

### 核心验收场景

1. 原插件无源，其他插件可用，能自动换源。
2. 原插件返回无效 URL，底层播放失败，能自动换源。
3. 所有候选失败，能暂停或跳下一曲。
4. 自建歌单播放失败能换源。
5. 禁用 / 失效 / 归档插件不参与候选。
6. 插件排序影响候选顺序。
7. 换源成功后缓存生效。
8. 换源缓存可清理。
9. 下载成功 / 失败历史可查看。
10. Android 真机上后台播放和下载状态稳定。

---

## 8. 待确认问题

### Q1. 分支创建时机

是否现在就从 `v0.6.2 = b3cb5e5` 创建功能分支？

建议分支名：

```text
feat/0.6.2-custom
```

### Q2. 插件自动临时不可用的阈值

连续失败多少次后标记 `quarantined`？

建议：

```text
连续 3 次插件级失败
```

需要确认是否接受。

### Q3. 临时不可用恢复时间

自动恢复 TTL 建议多久？

选项：

1. 1 小时；
2. 6 小时；
3. 24 小时；
4. 只允许手动恢复。

建议默认 24 小时。

### Q4. 手动标记失效的语义

“用户手动标记失效”是否等同永久屏蔽，直到用户手动恢复？

建议：是。

### Q5. 归档插件是否参与兜底

归档插件默认不参与候选。

是否允许在所有正常插件都失败后，把归档插件作为最后兜底？

建议：第一版不允许，保持行为可预期。

### Q6. 相同插件身份判定

“不同订阅下载的相同音源插件”如何判定相同？

可选依据：

1. `plugin.name` 完全相同；
2. `plugin.name + plugin.version`；
3. 插件内容 hash；
4. `name + srcUrl 域名`；
5. 用户手动分组。

当前系统最可靠的是 `name` 和内容 `hash`，但没有可信的全局插件包 ID。
需要确认第一版是否接受“相同 `name` 分组”。

### Q7. 严格匹配的具体字段

默认严格匹配建议：

```text
规范化 title 相等
规范化 artist 相等
```

是否还要求：

1. album 相等？
2. duration 差值小于 2~3 秒？
3. 多歌手时主歌手匹配即可，还是歌手集合完全一致？

### Q8. 换源缓存清理入口

清理入口放在哪里？

选项：

1. 基本设置；
2. 播放页菜单；
3. 缓存管理；
4. 只提供全局清理；
5. 第一版只提供设置页全局清理。

### Q9. 运行时播放失败的最大尝试次数

建议：

1. 最多尝试 3 个备用候选；
2. 总时间预算 10~15 秒；
3. 超时后不再继续，按普通播放失败处理。

是否接受？

### Q10. 插件健康是否影响搜索

自动临时不可用插件：

1. 只影响换源候选；
2. 同时从搜索结果中隐藏；
3. 搜索结果中显示但带失效标签。

建议：第一版只影响换源候选，搜索行为不变。

### Q11. 下载历史的保留策略【已确认】

第二轮确认结果：

1. 全部状态合计保留最近 10 条；
2. 成功 / 失败都保留；
3. 用户可清空全部或仅清空失败。
### Q12. 下载失败记录中的重试【已确认】

第二轮确认结果：第一版不实现失败重试。这里的“不实现”包括不提供手动重试按钮，也不做自动重试；失败重试作为后续独立需求再评估。
### Q13. 备份范围

以下数据是否需要进入现有备份 / 恢复？

1. 插件健康状态；
2. 插件归档状态；
3. 换源缓存；
4. 下载历史。

建议第一版不进入备份，后续再评估，避免迁移复杂化。

### Q14. 插件排序作用范围

当前插件排序已有 UI。

换源候选使用：

1. 一个全局插件顺序；
2. 播放 / 搜索 / 下载分别配置不同顺序；
3. 第一版直接复用现有全局顺序。

建议：第一版复用现有全局顺序。

### Q15. 设置页暴露程度

换源相关配置第一版是：

1. 只有总开关，其他使用内置保守值；
2. 暴露严格匹配开关；
3. 暴露最大候选数；
4. 暴露超时时间。

建议：第一版只暴露总开关和严格匹配开关。

---

## 9. 当前状态

- 已完成只读调查。
- 已记录用户第一轮澄清。
- 已将插件管理扩展为独立需求。
- 尚未创建功能分支。
- 尚未修改源码。
- 尚未开始实现。
- 需要先确认第 8 节中的待确认问题。


---

## 10. 第二轮需求澄清（2026-10-14）

### 10.1 用户新确认

| 编号 | 决策 |
|---|---|
| D13 | 从 `v0.6.2 = b3cb5e5829dc600af86731c582429f5eb99cad27` 创建新分支开发。 |
| D14 | 一个需求一个分支；功能完成前必须验证、review、测试；完成后等待用户确认，再开始下一个需求。 |
| D15 | 插件连续失败 5 次后标记为“临时不可用”。 |
| D16 | 自动“临时不可用”在下一次应用启动时恢复；用户手动状态不自动恢复。 |
| D17 | 不同订阅来源的相同音源插件可以按组展示。 |
| D18 | 相似歌曲匹配要求校验 `duration`；`album` 校验可选。 |
| D19 | 换源最多尝试 5 个“可用状态”候选，总超时 15 秒。 |
| D20 | 换源缓存清理入口放在设置项中。 |
| D21 | 下载历史保留 10 条；第一版不实现失败记录的手动 / 自动重试，重试作为后续需求。 |
| D22 | 插件临时失效要影响搜索结果。 |
| D23 | 插件健康状态、换源缓存、下载历史暂不进入备份 / 恢复。 |
| D24 | 新增插件订阅管理 / UI 层级需求，继续调查订阅与插件关系。 |
| D25 | 后续执行计划和决策分别维护在 `docs/PLAN.md`、`docs/decisions.md`。 |

补充解释：

1. “连续失败 5 次”只统计插件级失败，不统计设备离线、用户禁止移动网络、DNS / TLS / 代理类全局网络问题。
2. “下一次启动恢复”建议只恢复自动临时不可用；`disabled`、`userInvalid`、`archived` 等用户或治理状态不应自动恢复。
3. “可用状态候选”默认排除：
   - `disabled`；
   - `quarantined`；
   - `userInvalid`；
   - `archived`。
4. `album` 可选的含义是：匹配器支持开启 / 关闭 album 校验，默认第一版不强制要求 album 相等，除非后续另确认。

---

## 11. 新增需求 R5：插件订阅关系、重复插件与设置层级优化

### 11.1 背景

用户反馈当前订阅设置位于插件管理页 AppBar 的隐藏菜单中，层级不合理。需要确认订阅和插件的关系，以及“更新插件 / 更新订阅”是否可能造成重复插件。

### 11.2 当前实现调查结论

#### UI 层级

插件列表页：

```text
src/pages/setting/settingTypes/pluginSetting/views/pluginList.tsx
```

当前入口：

1. AppBar 右侧菜单里包含：
   - 订阅设置；
   - 插件排序；
   - 卸载全部插件。
2. FAB 菜单里包含：
   - 从本地安装插件；
   - 从网络安装插件；
   - 更新全部插件；
   - 更新订阅。

因此“订阅设置”确实被放在 AppBar 隐藏菜单中，而“更新订阅”又在 FAB 菜单中，两者入口分离，层级确实不清晰。

#### 订阅与插件的数据关系

订阅配置保存位置：

```text
plugin.subscribeUrl
```

数据结构：

```ts
interface ISubscribeItem {
  name: string;
  url: string;
}
```

当前关系：

1. 订阅只保存名称和 URL。
2. 系统没有持久化“某个插件来自哪个订阅”的映射。
3. 单个插件更新依赖插件自身 `instance.srcUrl`，与订阅 URL 是两套关系。
4. 更新订阅时，应用重新拉取订阅 URL：
   - 如果是 `.js`，当作单个插件安装；
   - 如果是 `.json`，解析 `plugins[].url`，再逐个下载并安装。
5. 如果插件从订阅 JSON 中被作者移除，已安装到本地的插件不会被自动删除。
6. 如果订阅被用户删除，已通过该订阅安装的插件也不会被自动删除。

#### 当前重复插件行为

安装 / 更新逻辑位于：

```text
src/core/pluginManager/index.ts
```

当前判定：

1. 插件内容 hash 是文件内容 SHA-256。
2. 如果待安装插件 hash 与已安装插件 hash 相同，会静默忽略，返回“插件已安装”。
3. 如果存在相同 `plugin.name` 的旧插件：
   - 默认情况下，待安装版本低于已安装版本时会拒绝；
   - 待安装版本不低时，会安装新文件并删除旧文件；
   - 如果用户开启“不检查插件版本”，则不再拦截低版本。
4. 如果插件作者修改了 `plugin.name`：
   - 新插件会按新名称安装；
   - 旧名称插件不会被删除；
   - 功能上可能出现重复音源插件。
5. 如果订阅 JSON 中有多个同名插件，最终通常只保留一个，但存在并发竞态风险。
6. 当前从订阅 JSON 拉取插件列表后使用 `Promise.all` 并发安装。并发路径可能同时读取同一份插件列表快照，在极端情况下导致同一内容或同名插件重复写入。

### 11.3 当前风险结论

| 风险 | 当前是否存在 | 说明 |
|---|---:|---|
| 完全相同内容的插件重复安装 | 理论上可能 | 串行场景会通过 hash 去重；并发安装存在竞态风险。 |
| 同名插件重复安装 | 正常串行不会 | 相同 `name` 会替换旧插件。 |
| 插件改名后出现功能重复 | 会 | 旧 `name` 和新 `name` 会被视为两个插件。 |
| 多个订阅包含同一插件 | 部分处理 | 相同 hash 会忽略；相同 name 会替换；但来源关系未持久化。 |
| 插件从订阅移除后本地残留 | 会 | 当前没有自动清理机制。 |
| 删除订阅后插件残留 | 会 | 当前没有关联清理机制。 |
| 更新订阅与更新全部插件并发冲突 | 可能 | 缺少统一安装 / 更新队列。 |
| 订阅 JSON 并发安装竞态 | 可能 | `Promise.all` 并发调用安装器。 |

### 11.4 建议需求范围

第一版建议做“订阅管理信息与防重复”，不做激进的自动删除。

#### 功能点

1. 将插件管理页改成清晰的分区页面：
   - 已安装插件；
   - 订阅管理；
   - 排序；
   - 维护操作（更新全部、清理、卸载全部）。
2. 订阅设置入口从隐藏菜单提升为一级入口。
3. 为订阅生成稳定 ID，例如 `subscriptionId`。
4. 记录插件来源关系：
   - `pluginHash`；
   - `pluginName`；
   - `subscriptionId`；
   - 来源 URL；
   - 最近安装时间；
   - 最近安装版本。
5. 订阅更新改为串行任务队列，避免并发写插件列表。
6. 订阅内插件安装也改为串行或加锁，避免同名 / 同 hash 竞态。
7. 相同 `plugin.name` 插件分组展示。
8. 低版本或重复来源插件默认归档，不参与搜索和换源。
9. 插件从订阅中消失时，默认不自动删除，只显示“订阅中已不存在 / 可清理”。
10. 用户删除订阅时，询问是否同时删除由该订阅安装的插件。

#### 不建议第一版自动删除

原因：

1. 当前没有可靠的订阅来源映射，贸然删除可能误删用户手动更新过的插件。
2. 插件可能同时来自多个订阅。
3. 插件可能已经通过自身 `srcUrl` 更新到更新版本。
4. 用户可能希望保留订阅中已下架的插件。

### 11.5 R5 影响文件

```text
src/core/pluginManager/index.ts
src/core/pluginManager/meta.ts
src/core/pluginManager/subscription.ts
src/pages/setting/settingTypes/pluginSetting/index.tsx
src/pages/setting/settingTypes/pluginSetting/views/pluginList.tsx
src/pages/setting/settingTypes/pluginSetting/views/pluginSubscribe.tsx
src/pages/setting/settingTypes/pluginSetting/components/pluginItem.tsx
src/types/core/pluginManager/index.d.ts
src/core/i18n/languages/zh-cn.json
src/core/i18n/languages/zh-tw.json
src/core/i18n/languages/en-us.json
src/types/core/i18n/index.d.ts
```

### 11.6 R5 验收标准

1. 插件管理页可明显看到订阅管理入口。
2. 用户可以查看每个订阅的 URL 和最近更新时间。
3. 可以查看插件来源分组。
4. 相同内容插件不会重复安装。
5. 同名插件不会因并发更新产生重复。
6. 插件改名导致的旧 / 新插件能被识别为“疑似重复音源”，并可由用户处理。
7. 更新订阅过程中不会出现插件列表写入竞态。
8. 删除订阅时用户可以选择是否删除关联插件。
9. 订阅中已消失的插件不会自动删除，但能被用户识别和清理。
10. 插件排序、启用 / 禁用、失效标记等功能不被破坏。

---

## 12. 建议分支与实施顺序

遵守“一个需求一个分支”。当前建议顺序以依赖关系为准，最终顺序待用户确认。

| 阶段 | 需求 | 建议分支 | 说明 |
|---|---|---|---|
| 1 | R3 插件健康与状态管理 | `feat/0.6.2-plugin-health` | 先建立 `quarantined` / `userInvalid` / `archived` 状态，供后续换源候选过滤复用。 |
| 2 | R1 + R2 播放失败换源 | `feat/0.6.2-play-source-fallback` | 实现集中换源解析器，消费插件健康状态和插件排序。 |
| 3 | R5 插件订阅与防重复 | `feat/0.6.2-plugin-subscription` | 优化订阅 UI 层级、来源映射、更新队列和重复插件处理。 |
| 4 | R4 下载结果历史 | `feat/0.6.2-download-history` | 持久化最近 10 条下载结果。 |
| 5 | R6 插件启动加载与恢复优化 | `feat/0.6.2-plugin-startup` | 元数据先行、代码按需挂载；与 R3/R5 协同。 |
| 6 | 最终回归 | 复查各功能分支合并结果 | Android 真机回归。 |

说明：R2 自建歌单不做独立配置，因此不再单独开分支；其验收场景并入 R1 播放换源分支。

每个分支完成定义：

1. `npx tsc --noEmit` 通过；
2. 不自动改文件的 ESLint 检查通过；
3. `npm run test` 通过；
4. Android debug 构建通过；
5. Android 真机完成该需求验收场景；
6. 自查 diff，确认没有夹带无关改动；
7. 用户确认后才进入下一个需求分支。

---

## 13. 第二轮后仍待确认问题

### Q16. 分支顺序确认

是否接受以下实施顺序？

```text
R3 插件健康
-> R1/R2 播放换源
-> R5 订阅与防重复
-> R4 下载历史
```

如果想先获得播放换源能力，也可以改为 R1 先行，但后续需要少量返工把插件健康过滤接入。

### Q17. “下一次启动恢复”的边界

自动 `quarantined` 下次启动恢复已经确认。

但以下状态是否按建议处理？

```text
disabled      保持
userInvalid   保持
archived      保持
解析失败      保持 Error
版本不匹配    保持 Error
```

建议：是。

### Q18. duration 匹配阈值

已确认要校验 duration。

建议默认：

```text
候选歌曲 duration 与原歌曲 duration 差值 <= 3 秒
```

是否接受 3 秒？

### Q19. album 校验默认值

`album` 已确认可选。

第一版默认是否关闭 album 强制校验？

建议：关闭，即 album 不同不直接导致匹配失败。

### Q20. 下载历史的“10 条”口径

下载历史保留 10 条，具体是：

1. 全部状态合计保留最近 10 条；
2. 成功保留最近 10 条，失败另保留最近 10 条；
3. 每个插件 / 每首歌保留 10 条。

建议：全部状态合计保留最近 10 条。

### Q21. 临时失效插件在搜索结果中的表现

已确认临时失效要影响搜索结果。

具体表现建议：

1. 从搜索执行列表中排除；
2. 搜索页不展示该插件结果；
3. 插件管理页仍显示，并带“临时不可用”标签。

是否接受？

### Q22. 用户手动失效插件是否影响搜索

建议：

```text
userInvalid  影响搜索
archived     影响搜索
disabled     影响搜索
quarantined  影响搜索
```

是否确认？

### Q23. 订阅来源映射和删除策略

是否接受第一版策略？

```text
记录插件来源，但不自动删除订阅中已消失的插件；
删除订阅时弹窗询问是否删除关联插件。
```

### Q24. 插件改名 / 疑似重复音源的处理

如果插件 `name` 改变，系统无法自动确认它们是同一个音源。

第一版建议：

1. 按相同 `name` 分组；
2. 不同 `name` 不自动合并；
3. 后续可增加用户手动标记“同一音源”的关系。

是否接受？

### Q25. 相同版本但内容变化的插件

如果插件版本号不变，但文件内容变化，hash 会变化。

默认行为建议：

1. 相同 `name` 时允许替换；
2. 旧版本进入归档记录或至少写入更新历史；
3. 不长期保留多个旧文件。

是否接受？

### Q26. 插件管理 UI 方案【已确认】

确认结果：采用分区页面，不采用 Tab 页。

基础布局：

```text
插件管理
- 顶部概览：可用 / 临时不可用 / 失效 / 归档数量
- 已安装插件列表
- 订阅管理入口
- 插件排序入口
- 维护操作：更新全部 / 清理缓存 / 卸载全部
```
## 14. 文档维护策略

后续以三份文档配合使用：

| 文档 | 用途 |
|---|---|
| `docs/fork-requirements.md` | 完整需求背景、调查结论、风险和验收标准。 |
| `docs/decisions.md` | 精简决策日志，只记录已经确认的结论。 |
| `docs/PLAN.md` | 按 `docs/PLAN-TEMPLATE.md` 生成的执行计划、阶段状态、DoD 和变更日志。 |

本文中的旧建议如与 `docs/decisions.md` 冲突，以 `docs/decisions.md` 最新决策为准。

---

## 15. 补充待确认问题

### Q27. 文档基线与提交方式

当前 `docs/fork-requirements.md`、`docs/decisions.md`、`docs/PLAN.md` 以及原有 `docs/PLAN-TEMPLATE.md` 都处于未跟踪状态，当前分支仍是 `master`。

建议做法：

1. 先从 `v0.6.2 = b3cb5e5` 创建 `docs/requirements-baseline`；
2. 将本轮文档提交到该分支；
3. 你 review 文档；
4. 后续第一个功能分支基于该文档提交创建，避免每个功能分支重复携带未跟踪文档。

是否接受？
如果你希望文档直接保留在本地、暂不创建 docs 分支，也可以；但这会导致后续切分支时需要额外处理未跟踪文件。




---

## 16. 最终确认与执行裁决（2026-10-14）

用户已确认 Q16-Q27 全部按文档建议值执行。要点如下：

| 编号 | 最终裁决 |
|---|---|
| Q16 | 实施顺序：R3 -> R1/R2 -> R5 -> R4。 |
| Q17 | 解析失败 / 版本不匹配保持 Error，不随启动自动恢复。 |
| Q18 | duration 差值阈值为 3 秒。 |
| Q19 | album 强制校验默认关闭。 |
| Q20 | 下载历史为全部状态合计保留最近 10 条。 |
| Q21 | 临时失效插件从搜索执行列表排除；插件管理页显示“临时不可用”标签。 |
| Q22 | `userInvalid` / `archived` 均影响搜索结果。 |
| Q23 | 记录订阅来源，不自动删除订阅中消失的插件；删除订阅时询问是否删除关联插件。 |
| Q24 | 插件改名不自动合并；后续支持用户手动标记同一音源。 |
| Q25 | 相同版本但内容变化的同名插件允许替换，并记录旧内容历史。 |
| Q26 | 插件管理页采用分区页面。 |
| Q27 | 先创建 `docs/requirements-baseline` 分支提交文档，再创建功能分支。 |

据此，需求澄清阶段完成。后续功能开发必须从文档基线分支创建对应 feature 分支。


---

## 17. R6 补充裁决（2026-10-14）

基于 2026-10-14 真机启动排查，新增 R6：插件启动加载与播放状态恢复优化。

### 裁决

| 编号 | 裁决 |
|---|---|
| D38 | R6 作为独立后续需求；不改变 D27 确认的 R3 -> R1/R2 -> R5 -> R4 顺序。 |
| D39 | 插件启动阶段只恢复元数据；不因索引或列表展示执行插件代码。 |
| D40 | 未开启“软件启动时自动播放”时，不主动请求真实音源。 |
| D41 | 歌词自动搜索延迟到启动图隐藏后，并做单飞和缓存。 |

### 排查快照

- 设备插件目录：48 个 JS 文件，约 1.8MB。
- 插件初始化实测：约 3.9-4.9 秒。
- 播放恢复队列：40 首，当前歌为 Bach / Wagner 等曲目，队列中没有《童话镇》。
- 《童话镇》请求来源：至少 3 个第三方插件源码顶层的调试代码。

R6 实施前，用户可通过卸载 / 禁用遗留调试代码的插件缓解问题。

---

## 18. R1/R2 收尾确认（2026-10-15）

### 裁决

| 编号 | 裁决 |
|---|---|
| D42 | 换源候选只从已启用、可搜索且健康状态为 `available` 的插件中选择；`disabled`、`quarantined`、`userInvalid`、`archived` 直接排除。不可用插件不降级排序到候选列表尾部。 |
| D43 | 停止条件是 OR / 任一条件先满足：候选耗尽、已尝试 5 个、15 秒预算到期、当前歌曲切换。不是“达到 5 个且时间到期”同时满足。单次插件请求不做中途强杀，预算在阶段边界检查。 |

### 收尾结论

1. 严格匹配缺省值已确认为开启；运行时对缺失配置使用 `?? true`。
2. duration 差值单位已确认为秒，阈值为 3 秒。
3. 候选来源过滤、替代插件优先、插件排序、总预算和最大尝试数与冻结需求一致。
4. 2026-10-15 真机日志显示：`小枸音乐` 找到严格匹配候选，但 `getMediaSource` 失败；后续候选没有匹配结果，会话在第 5 个候选处停止。该现象不是匹配条件错误。
5. R1/R2 逻辑本阶段收尾。若后续确需“不可用插件降级排序到候选尾部”，应作为新的增量需求，不在当前分支继续扩展。
