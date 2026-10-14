# MusicFree Fork Handoff

更新时间：2026-10-14
当前状态：R3 已完成；R6 已写入文档但暂不实施；下一阶段是 R1/R2。

## 1. Git 状态

当前分支：

```text
feat/0.6.2-plugin-health
```

功能基线：

```text
v0.6.2 = b3cb5e5829dc600af86731c582429f5eb99cad27
```

已确认顺序不变：

```text
R3 -> R1/R2 -> R5 -> R4
```

R6 是新增的独立后续需求，排在现有顺序之后。

关键提交：

```text
2afdf31 feat(plugin): add plugin health lifecycle
8fa903d fix(ui): pass tab item key explicitly
e3ccfa1 chore(android): tune arm64 debug build
HEAD    docs(requirements): add R6 startup optimization
```

本次已提交：

1. R3 插件健康生命周期。
2. TabView key warning 修复。
3. Android 本地构建配置。
4. R6 需求文档与 handoff。

## 2. 下一阶段：R1/R2

下一阶段应创建：

```text
feat/0.6.2-play-source-fallback
```

建议从当前分支创建，因为 R1/R2 依赖 R3 的插件健康状态过滤。

核心要求：

1. 覆盖取源失败和底层播放失败。
2. 最多尝试 5 个 `available` 候选。
3. 总超时 15 秒。
4. 候选按现有插件排序优先级。
5. 严格匹配：
   - title 规范化后一致；
   - artist 规范化后一致；
   - duration 差值不超过 3 秒；
   - album 默认不强制校验；
   - 不用模糊编辑距离兜底。
6. `basic.tryChangeSourceWhenPlayFail` 默认开启。
7. 换源成功结果缓存，并提供清理入口。
8. 自建歌单走全局策略，不做歌单级配置。
9. 消费 R3 的 `isPluginAvailableForService()`，排除 `disabled`、`quarantined`、`userInvalid`、`archived`。

完整范围见：

```text
docs/fork-requirements.md
docs/decisions.md
docs/PLAN.md
```

## 3. R6 当前定位

R6 已写入文档，但本阶段不实施。

主题：

```text
插件启动加载与播放状态恢复优化
```

关键边界：

1. 启动时只恢复插件元数据，不执行插件代码。
2. 首次调用插件方法时再挂载。
3. 未开启“软件启动时自动播放”时，不主动请求真实音源。
4. 歌词自动搜索延迟到启动图隐藏后，并做单飞和缓存。
5. 不修改第三方插件源码；第一版不做插件静态审计。

排查结论也已记录：启动时大量“童话镇”请求来自第三方插件顶层调试代码，至少涉及“小芸音乐”“WebFilter”“小蜗音乐”。不是播放队列或歌词管理器自身错误。

## 4. 本地调试与构建约定

用户后续自行构建。当前约定：

```properties
org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g
reactNativeArchitectures=arm64-v8a
```

本地开发调试流程：

```powershell
npx react-native start
adb -s <serial> reverse --no-rebind tcp:8081 tcp:8081
adb -s <serial> install -r android\app\build\outputs\apk\debug\app-arm64-v8a-debug.apk
adb -s <serial> shell am start -n fun.upup.musicfree/.MainActivity
```

注意：

1. 当前项目没有 `assembleArm64Debug` 任务；使用 `assembleDebug`，安装 arm64 APK。
2. debug APK 不内嵌 JS bundle，必须连接 Metro 并做 adb reverse。
3. Metro bundle 异常陈旧时用：

```powershell
npx react-native start --reset-cache
```

4. Gradle daemon 参数变化后不会复用旧 daemon。构建完成后建议：

```powershell
.\gradlew --stop
```

避免多个 Gradle / Kotlin daemon 占满内存。

## 5. 验证命令

```powershell
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/eslint/bin/eslint.js <changed-files>
node node_modules/jest/bin/jest.js --passWithNoTests
git diff --check
```

Android 真机验收继续使用 Android 设备；iOS 暂不验收。

## 6. 重要禁止事项

1. 不推送 origin。
2. 不向原作者仓库提 PR。
3. 不合并 `v0.6.3-beta.*`。
4. 不新增运行时依赖。
5. 不把健康状态、换源缓存、下载历史加入备份。
6. 不整仓 / 整文件格式化。
7. 不在 R1/R2 中直接实施 R6。
8. 不把 `quarantined`、`userInvalid`、`archived` 与现有 `disabled` 混为一个状态。
