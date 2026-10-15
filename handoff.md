# MusicFree Fork Handoff

更新时间：2026-10-15
当前状态：R3、R1/R2、R4、R5 已收尾；R6 代码实现中，待 Android 真机验收。

## 1. 分支与提交

当前收尾分支：

```text
feat/0.6.2-download-history
```

R4 关键提交：

```text
2e5285f feat(download): add download result history
a1340ce fix(download): expose entry and refine history rows
```

下一个需求从当前收尾分支创建：

```text
feat/0.6.2-plugin-startup
```

实施顺序保持：

```text
R3 -> R1/R2 -> R5 -> R4 -> R6
```

## 2. R4 收尾口径

1. 下载历史使用独立 MMKV store `download.history`，不进入备份 / 恢复。
2. 全部状态合计保留最近 10 条；成功 / 失败 / 进行中均记录。
3. 重启后 pending 记录标记为中断失败；不影响本地音乐入库逻辑。
4. 下载页支持全部 / 进行中 / 成功 / 失败筛选和清空历史。
5. 首页新增快捷「下载」入口；历史行自适应高度避免信息重叠。
6. 第一版不做系统通知、前台服务、断点续传和失败重试。

## 3. 下一阶段：R6

目标：插件启动加载与播放状态恢复优化。元数据先行、代码按需挂载，治理被动恢复引发的取源和歌词搜索。

必须先读：

```text
docs/fork-requirements.md 第 R6 章节
docs/decisions.md D38 / D39 / D40 / D41
```

第一版边界：

1. 启动只恢复插件元数据，不执行插件代码；首次服务调用时再挂载。
2. 未开启启动自动播放时，不主动请求真实音源。
3. 歌词自动搜索延迟到启动图隐藏后，并做单飞和缓存。
4. 不新增运行时依赖。
5. 不修改第三方插件源码；不做静态审计。

建议核心文件：

```text
src/core/pluginManager/index.ts
src/core/pluginManager/plugin.ts
src/core/trackPlayer/index.ts
src/core/lyricManager.ts
src/entry/bootstrap/bootstrap.ts
```

## 4. 验证与约束

代码改动后至少执行：

```powershell
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/eslint/bin/eslint.js <changed-ts-files>
node node_modules/jest/bin/jest.js --passWithNoTests
git diff --check
```

Android 真机由用户构建验收；最终统一回归在全部需求分支完成后进行。

禁止：推送 origin、提交 run.md / testresult.md、新增运行时依赖、混入 R4 / R6 之外需求、整仓格式化。
