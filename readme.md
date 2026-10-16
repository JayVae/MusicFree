# MusicFree Fork

**中文** | [English](./readme-en.md)

这是 [maotoumao/MusicFree](https://github.com/maotoumao/MusicFree) 的个人功能分支，基于上游 `v0.6.2` 修改，当前版本为 `v0.6.3`。项目保留上游的插件化音乐播放器架构，重点增强了 Android 上的播放源容错、插件管理和下载结果追踪。

> 本仓库是个人使用与学习用途的分叉，不是上游官方发行版。插件本身不随本应用分发，也不提供任何音源。

## 与上游的主要差异

### 播放源容错与连续性
- 搜索、取源或底层播放失败时，可在其他已启用插件中选择候选并自动重试。
- 采用严格匹配策略，降低误匹配到同名或不同版本歌曲的概率。
- 自建歌单继承换源能力，并支持歌单级来源偏好。
- 支持批量换源与播放页临时来源展示；解析结果会缓存以减少重复请求。
- 候选尝试有超时、失败和切歌等停止条件，避免播放链路长时间阻塞。

### 插件健康管理
- 插件可标记为临时不可用、手动失效或归档，不再参与播放候选。
- 安装和更新流程会保留插件元数据、版本、订阅来源和来源分组。
- 启动时优先恢复插件元数据，插件代码按需挂载，降低启动压力。

### 插件订阅与来源分组
- 支持插件订阅源的添加、更新、删除和状态查看。
- 同名插件更新时执行版本比较，低版本重复内容可归档，避免误降级。
- 插件可按本地、网络和订阅来源分组，支持组级状态管理。

### 批量可用性测试
- 可在插件管理中选择多个插件批量测试。
- 搜索或取源任一链路成功即视为可用；双链路失败会自动标注。
- 测试结果有助于快速定位失效插件，避免逐个手动排查。

### 下载结果历史
- 记录最近的下载成功与失败结果。
- 可在下载页查看结果状态、时间和相关歌曲信息，便于确认下载链路是否异常。

## 下载

从 [Releases](https://github.com/JayVae/MusicFree/releases) 获取 `v0.6.3` Android APK：

| 文件 | 适用场景 |
|---|---|
| `app-universal-release.apk` | 不确定设备 ABI 时使用 |
| `app-arm64-v8a-release.apk` | 现代 Android 手机常用架构 |
| `app-armeabi-v7a-release.apk` | 旧款 32 位 ARM 设备 |
| `app-x86_64-release.apk` / `app-x86-release.apk` | 模拟器或 x86 设备 |

发布资产中包含 `SHA256SUMS.txt`，安装前可校验文件完整性。当前 GitHub Actions 构建在未配置正式签名 Secrets 时会使用 debug keystore 签名，个人设备可直接安装，但不应用于正式分发。

## 本地构建

需要 Node.js 20+、JDK 17 和 Android SDK。

```bash
npm ci
npx tsc --noEmit
npm test -- --passWithNoTests

# Android debug
npm run android

# Android release
cd android
GRADLE_USER_HOME="$USERPROFILE/.gradle" ./gradlew assembleRelease
```

Windows 下如果 Gradle 缓存路径受限，请保留 `GRADLE_USER_HOME` 指向用户目录。Release 构建前需要提供 `android/keystore.properties` 与 keystore，或使用 CI 中的 debug keystore 回退逻辑。

## 使用与法律边界

- 本应用只是一个播放器框架，不内置任何音乐源；内容访问能力由用户自行安装的插件决定。
- 不提供、不鼓励、不支持任何绕过付费限制或破解版权保护的行为。
- 请自行评估插件安全性；第三方插件和插件产生的数据与本仓库无关。
- 请遵守当地法律法规，仅处理有权使用的音乐内容。

## 文档与归档

- 上游项目：<https://github.com/maotoumao/MusicFree>
- 上游插件文档与示例：<https://github.com/maotoumao/MusicFreePlugins>
- 原版中文 README：[`docs/archive/readme-upstream-v0.6.2.md`](./docs/archive/readme-upstream-v0.6.2.md)
- 原版英文 README：[`docs/archive/readme-en-upstream-v0.6.2.md`](./docs/archive/readme-en-upstream-v0.6.2.md)
- 本 Fork 的需求与阶段记录：[`docs/PLAN.md`](./docs/PLAN.md)、[`docs/fork-requirements.md`](./docs/fork-requirements.md)

## 许可

本项目沿用上游的 [AGPL-3.0](./LICENSE) 协议。感谢 [@maotoumao](https://github.com/maotoumao) 及所有上游贡献者。
