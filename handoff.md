# MusicFree Fork Handoff

更新时间：2026-10-15
当前状态：R3、R1/R2、R5 代码阶段均已收尾；下一阶段是 R4。

## 1. 分支与提交

当前收尾分支：

```text
feat/0.6.2-plugin-subscription
```

R5 关键提交：

```text
b953a69 feat(plugin): add subscription source management
d2f8534 fix(plugin): improve subscription management feedback
19c35e1 fix(plugin): simplify subscription deletion and layout
664553d fix(plugin): refine overview stats and subscription entry
```

下一个需求从当前收尾分支创建：

```text
feat/0.6.2-download-history
```

实施顺序保持：

```text
R3 -> R1/R2 -> R5 -> R4 -> R6
```

## 2. R5 收尾口径

1. 订阅 URL 生成稳定 ID；插件来源映射保存在独立 MMKV store `plugin.subscription`。
2. URL / 本地插件安装串行；订阅更新整体也串行。
3. 相同名插件分组；相同 `srcUrl` 的改名插件标记疑似重复并默认归档。
4. 订阅中消失的插件只标记可清理，不自动删除。
5. 删除订阅固定删除关联插件，并同步从订阅配置中移除。
6. 插件管理页分区：概览统计、订阅管理、折叠维护、已安装插件、排序。
7. 订阅项直达详情；详情支持编辑、复制、单独更新、删除和只读插件列表。
8. 订阅添加入口在插件管理页“订阅管理”分区首行。
9. 已知延后：内置订阅分组、订阅内插件统一状态、本地 / 网络来源分组、启动懒加载彻底生效。

## 3. 下一阶段：R4

目标：下载结果历史，合计保留最近 10 条成功 / 失败记录。

必须先读：

```text
docs/fork-requirements.md 第 10 章 R4
docs/decisions.md D21 / D23 / D31
```

第一版边界：

1. 不新增运行时依赖。
2. 不做系统通知、前台服务、断点续传。
3. 不做失败记录手动 / 自动重试。
4. 下载历史不进入备份 / 恢复。
5. 不影响当前下载完成后的本地音乐入库逻辑。

建议核心文件：

```text
src/core/downloader.ts
src/core/downloadHistory.ts
src/pages/downloading/downloadingList.tsx
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
