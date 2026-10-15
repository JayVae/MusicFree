# MusicFree Fork Handoff

更新时间：2026-10-15
当前状态：R3 与 R1/R2 已完成并收尾；R5 代码已在 `feat/0.6.2-plugin-subscription` 实现，等待 Android 真机验收。

## 1. Git 与阶段状态

当前收尾分支：

```text
feat/0.6.2-play-source-fallback
```

R5 当前开发分支：

```text
feat/0.6.2-plugin-subscription
```

功能基线：

```text
v0.6.2 = b3cb5e5829dc600af86731c582429f5eb99cad27
```

实施顺序冻结：

```text
R3 -> R1/R2 -> R5 -> R4 -> R6
```

关键提交：

```text
42453ac fix(player): use 3 second duration tolerance
c9ca480 fix(player): enforce strict fallback match by default
df273c9 fix(player): trace source fallback candidates
d40196a feat(player): add play source fallback
2afdf31 feat(plugin): add plugin health lifecycle
```

本次收尾只更新文档，不再修改 R1/R2 实现。

## 2. R1/R2 最终实现口径

核心文件：

```text
src/core/mediaSourceResolver.ts
src/core/trackPlayer/index.ts
src/core/pluginManager/health.ts
src/pages/setting/settingTypes/basicSetting.tsx
```

### 候选来源

1. 换源候选只选择插件：
   - 已启用；
   - 支持 `music` 搜索；
   - 插件健康状态为 `available`。
2. 直接排除：
   - 原始当前插件；
   - `disabled`；
   - `quarantined`；
   - `userInvalid`；
   - `archived`；
   - 不支持音乐搜索的插件。
3. 原插件配置的替代插件优先。
4. 其余候选按现有全局插件排序。
5. 不可用插件直接排除，不降级排序到候选列表尾部。该行为是本阶段确认口径；如未来要“不可用源排到后面”，必须作为新的增量需求另开分支。

### 停止条件

一个换源会话在任一条件先满足时停止：

1. 候选插件耗尽；
2. 已尝试 5 个候选插件；
3. 15 秒总预算到期；
4. 当前歌曲已切换。

因此不是“达到 5 个候选并且时间到期”同时满足。预算在搜索 / 取源的阶段边界检查；单个已经发出的插件请求不做中途强杀，所以实际耗时可能略越过 15 秒。

### 匹配规则

严格匹配默认开启；配置缺失时运行时也按开启处理：

1. `title` NFKC、小写、移除非字母数字后与原 `title` 或 `alias` 完全一致；
2. `artist` NFKC、小写、移除非字母数字后完全一致；
3. `duration` 差值不超过 3 秒；
4. `album` 默认不校验；
5. 关闭严格匹配只放宽文本匹配，不使用编辑距离兜底。

### 接入范围

1. 原插件取不到有效音源时进入集中换源。
2. 底层 `Event.PlaybackError` 会把失败 URL 报告给同一换源会话，然后继续下一个候选。
3. 同一失败 URL 只处理一次，避免播放器重复事件浪费候选。
4. 成功结果不改写原始歌曲身份，自建歌单自然继承全局策略。
5. 成功结果写入独立 MMKV store：`media-source.fallback`，缓存 key 为原歌 `platform::id`。
6. 缓存命中 URL 播放失败时会被剔除。
7. 缓存不进入备份；设置页有全局清理入口。

## 3. R1/R2 真机诊断结论

2026-10-15 日志确认：

1. 候选列表来自已启用且 `available` 的可搜索插件。
2. `小枸音乐` 对《有何不可 / 许嵩》找到严格匹配候选，duration 一致。
3. 该候选搜索成功，但 `getMediaSource` 失败。
4. 后续几个候选没有匹配结果；会话在第 5 个候选处停止，此时仍有剩余时间，这是“达到 5 个候选”这一 OR 条件触发的预期行为。
5. 未出现播放成功不代表匹配逻辑失效；当前现象主要指向外部插件 / 平台接口不可用或返回无匹配。
6. 匹配与停止逻辑不需要继续修；R1/R2 本阶段收尾。

复测或诊断时重点看日志：

```text
换源候选列表
尝试换源候选
换源候选搜索完成
换源候选匹配成功
换源候选取源失败
换源候选取源成功
播放失败换源成功
播放失败换源失败，执行原有失败策略
忽略重复播放失败事件
```

## 4. 收尾验证

本阶段已通过：

```powershell
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/eslint/bin/eslint.js src/core/mediaSourceResolver.ts src/core/trackPlayer/index.ts src/pages/setting/settingTypes/basicSetting.tsx
node node_modules/jest/bin/jest.js --passWithNoTests
git diff --check
```

Android 真机已完成多轮换源日志验收；剩余失败来自外部插件源可用性，不作为 R1/R2 代码继续修改的阻塞项。

## 5. 当前阶段：R5

当前分支：

```text
feat/0.6.2-plugin-subscription
```

目标主题：插件订阅关系、重复插件防抖、插件管理页信息架构优化。

### 当前实现口径

1. 订阅配置迁移为带 `id / name / url` 的数组；`id` 由订阅 URL 的 SHA-256 生成，URL 不变则 ID 稳定。
2. 独立 MMKV store `plugin.subscription` 保存插件来源映射和订阅更新信息，不进入备份。
3. 映射记录插件 `hash / name / subscriptionId / sourceUrl / installedVersion / installedAt`。
4. URL 安装和本地安装统一进入串行队列；订阅整体更新使用独立串行队列，内部安装仍复用安装队列。
5. 相同内容 hash 只保留一个文件，但会补充新的订阅来源映射。
6. 相同名称低版本内容不替换高版本；其来源记录为重复归档映射。
7. 不同名称但 `srcUrl` 相同的内容会安装为 `archived` 插件并标记疑似重复音源。
8. 管理页显示概览、已安装、订阅管理、排序和维护操作；同名插件显示分组。
9. 订阅快照只把不在最新订阅中的映射标记为 `missingFromSubscription`，不删除插件文件。
10. 删除订阅时保留插件或删除关联插件由用户选择；多个订阅共享的插件不会被单删订阅误删。

必须实现：

1. 插件管理页改为分区页：顶部概览、已安装插件、订阅管理、插件排序、维护操作。
2. 订阅设置从 AppBar 隐藏菜单提升为一级分区。
3. 为订阅生成稳定 ID，并记录插件与订阅来源映射。
4. 订阅更新和订阅内插件安装改为串行 / 队列，避免并发竞态。
5. 相同 `plugin.name` 插件分组展示。
6. 低版本或重复来源插件默认归档，不参与搜索和换源。
7. 订阅中消失的插件不自动删除，只标记“订阅中已不存在 / 可清理”。
8. 删除订阅时询问是否删除关联插件。
9. 继续不新增运行时依赖。

R5 不做：

1. 不向原作者仓库提交 PR。
2. 不合并 `v0.6.3-beta.*`。
3. 不把插件健康、换源缓存或下载历史加入备份。
4. 不把 R4 / R6 混入 R5。
5. 不做不可信插件源码静态审计。

详细需求：

```text
docs/fork-requirements.md 第 11 章
docs/decisions.md D24-D37
docs/PLAN.md 阶段 3
```

## 6. R5 待验收重点

1. 旧订阅配置打开插件页后自动获得稳定 ID，重复进入 ID 不变。
2. 更新订阅时观察日志和 UI：插件安装逐个执行，无并发覆盖。
3. 同一订阅中移除某个插件后再次更新，本地插件仍存在，但显示“订阅中已不存在”。
4. 删除订阅分别验证“仅删除订阅”和“删除订阅和插件”。
5. 相同名称不同版本分组；不同名称但相同 `srcUrl` 时新内容为已归档。
6. 插件排序、启用 / 禁用、临时不可用、手动失效、归档和换源不受影响。

## 7. 本地调试与构建约定

用户自行构建和真机验收。

```properties
org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g
reactNativeArchitectures=arm64-v8a
```

调试流程：

```powershell
npx react-native start
adb -s <serial> reverse --no-rebind tcp:8081 tcp:8081
adb -s <serial> install -r android\app\build\outputs\apk\debug\app-arm64-v8a-debug.apk
adb -s <serial> shell am start -n fun.upup.musicfree/.MainActivity
```

注意：

1. 使用 `assembleDebug`，没有 `assembleArm64Debug`。
2. debug APK 不内嵌 JS bundle，必须连接 Metro 并做 `adb reverse`。
3. Metro 缓存异常时使用 `npx react-native start --reset-cache`。
4. Gradle 构建后可执行 `.\gradlew --stop`。
5. 本地 `run.md`、`testresult.md` 是未跟踪日志，禁止提交。

## 8. 验证命令

文档或代码改动后至少执行：

```powershell
git diff --check
```

代码改动后执行：

```powershell
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/eslint/bin/eslint.js <changed-ts-files>
node node_modules/jest/bin/jest.js --passWithNoTests
```

Android 是唯一当前验收目标；iOS 暂不验收。

## 9. 重要禁止事项

1. 不推送 origin。
2. 不向原作者仓库提 PR。
3. 不合并 `v0.6.3-beta.*`。
4. 不新增运行时依赖。
5. 不把健康状态、换源缓存、下载历史加入备份。
6. 不整仓 / 整文件格式化。
7. 一个需求一个分支。
8. 不在 R5 中直接实施 R4 或 R6。
9. 不把 `quarantined`、`userInvalid`、`archived` 与 `disabled` 混为一个状态。