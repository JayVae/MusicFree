# MusicFree Fork Handoff

更新时间：2026-10-15
当前状态：R1/R2、R3、R4、R5、R6 已验收通过；第三轮需求澄清完成，下一阶段是 R7。

## 1. 分支

本轮文档分支：

```text
docs/requirements-round3
```

R7 开始时从该分支创建：

```text
feat/0.6.2-playback-source-adaptive
```

R7 完成后再创建：

```text
feat/0.6.2-plugin-source-groups
```

最终 Android 回归排在 R7 / R8 之后。

## 2. 第三轮分类结论

1. R7：临时来源展示、歌单来源偏好、歌单批量临时换源、候选停止条件修订、空结果候选抑制。
2. R8：本地安装组、手动网络安装组、可选内置组，以及订阅 / 分组内统一状态操作。
3. 不把空结果直接标记 `userInvalid`；只做临时候选抑制。
4. 不提供歌单级持久换源配置；R7 的自动偏好和用户主动批量操作是例外。
5. 组级状态是批量应用既有插件状态，不新增运行状态。

详见：

```text
docs/fork-requirements.md 第 19 章
docs/decisions.md D46-D51
```

## 3. R7 下一阶段要点

1. 换源成功后，播放页显示“临时来源：插件名”；不改写歌曲身份。
2. 记录 `歌单 ID + 原始 platform -> 成功插件` 的歌单内偏好。
3. 后续同歌单同来源歌曲优先尝试该插件；失败后降级或清理偏好。
4. 歌单页提供批量临时换源入口，串行执行并反馈结果。
5. 候选停止条件改为候选耗尽、15 秒预算到期或切歌；取消 5 个上限。
6. 多次空结果插件临时候选抑制，非空结果或下次启动恢复。

建议先读：

```text
docs/fork-requirements.md 第 19 章 R7
docs/decisions.md D46-D49
```

## 4. 验证与约束

代码改动后至少执行：

```powershell
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/eslint/bin/eslint.js <changed-ts-files>
node node_modules/jest/bin/jest.js --passWithNoTests
git diff --check
```

Android 真机由用户构建验收。

禁止：提交 run.md / testresult.md、新增运行时依赖、混入 R7 / R8 之外需求、整仓格式化。
